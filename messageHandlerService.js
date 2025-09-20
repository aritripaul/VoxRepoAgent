// Required imports
const { ActivityTypes } = require("@microsoft/agents-activity");
const { AzureAIFoundryService } = require("./azureAIFoundryService");
const {
  AgentApplication,
  AttachmentDownloader,
  MemoryStorage,
} = require("@microsoft/agents-hosting");

class MessageHandlerService {
  constructor() {
    // Bot setup
    this.downloader = new AttachmentDownloader();
    this.storage = new MemoryStorage();
    this.agentApplication = new AgentApplication({
      storage: this.storage,
      fileDownloaders: [this.downloader],
    });

    // Azure AI Foundry integration via service class
    this.aiFoundryService = new AzureAIFoundryService();

    this.setupMessageHandler(); 
  }

  setupMessageHandler() {
    this.agentApplication.activity(ActivityTypes.Message, async (context, state) => {
      try {
        console.log('Inside activity message handler');
        await state.load(context, this.storage);
        console.log('Message text:', context.activity.text);
        
        try {
          const assistantMessage = await this.aiFoundryService.processUserMessage(context.activity.text);
          await context.sendActivity(assistantMessage);
        } catch (err) {
          await context.sendActivity(err.message || "Error communicating with Azure AI Foundry.");
        }
      } catch (err) {
        console.error("Error in activity handler:", err);
        await context.sendActivity(`Error communicating with Azure AI Foundry: ${err && err.message ? err.message : err}`);
      }
    });
  }

  async run(context) {
    await this.agentApplication.run(context);
  }
}

module.exports = { MessageHandlerService };

