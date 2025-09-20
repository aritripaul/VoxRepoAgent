const { DefaultAzureCredential } = require("@azure/identity");
const { AIProjectClient } = require("@azure/ai-projects");

class AzureAIFoundryService {
  constructor({ endpoint, agentId } = {}) {
    // Default Azure AI Foundry configuration
    this.endpoint = endpoint || "https://voxrepofoundry.services.ai.azure.com/api/projects/VoxRepoFoundryAI";
    this.agentId = agentId || "asst_2nwCGYhb5MJTLEl5Vfna32SL";
    
    this.project = new AIProjectClient(this.endpoint, new DefaultAzureCredential());
    
    console.log(`Azure AI Foundry Service initialized with endpoint: ${this.endpoint}, agentId: ${this.agentId}`);
  }

  async processUserMessage(userText) {
    // Get agent
    const agent = await this.project.agents.getAgent(this.agentId);
    // Create thread
    const thread = await this.project.agents.threads.create();
    // Create message
    await this.project.agents.messages.create(thread.id, "user", userText);
    // Create run
    let run = await this.project.agents.runs.create(thread.id, agent.id);
    // Wait for run to complete
    while (run.status === "queued" || run.status === "in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await this.project.agents.runs.get(thread.id, run.id);
    }
    if (run.status === "failed") {
      throw new Error(`Azure AI Foundry run failed: ${run.last_error}`);
    }
    // Get assistant message
    const messages = await this.project.agents.messages.list(thread.id, { order: "asc" });
    let assistantMessage = null;
    for await (const m of messages) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const content = m.content.find(c => c.type === "text" && c.text && typeof c.text.value === "string");
        if (content) {
          assistantMessage = content.text.value;
        }
      }
    }
    return assistantMessage || "No assistant response found.";
  }
}

module.exports = { AzureAIFoundryService };