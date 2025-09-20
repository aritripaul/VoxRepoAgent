const axios = require("axios");
const qs = require("qs");
const { SpeechService } = require('./speechService');

class CallHandlerService {
  constructor({ clientId, clientSecret, botCallbackUri } = {}) {
    // Default configuration - read from environment variables or use defaults
    this.clientId = clientId || process.env.clientId;
    this.clientSecret = clientSecret || process.env.clientSecret;
    this.botCallbackUri = botCallbackUri || "https://voxrepobot-f9e6b8a2dva9b4ex.canadacentral-01.azurewebsites.net/calling/callback";
    
    console.log(`Call Handler Service initialized with clientId: ${this.clientId ? '***' : 'undefined'}, botCallbackUri: ${this.botCallbackUri}`);
    
    if (!this.clientId || !this.clientSecret) {
      console.warn('CallHandlerService: clientId or clientSecret not provided. Call handling may not work properly.');
    }
  }

  async getAccessToken(tenantId) {
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const data = {
      client_id: this.clientId,
      scope: "https://graph.microsoft.com/.default",
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    };

    const response = await axios.post(tokenUrl, qs.stringify(data), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return response.data.access_token;
  }

  async answerCall(callId, accessToken) {
    const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}/answer`;
    const body = {
      callbackUri: this.botCallbackUri,
      mediaConfig: {
        "@odata.type": "#microsoft.graph.serviceHostedMediaConfig",
      },
      acceptedModalities: ["audio"],
    };

    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log('Answer response status:', response.status);
    console.log(`Answered call ${callId}`);
    return response;
  }

  async handleCallEvent(reqbody, onTranscriptionCallback = null) {
    console.log("Received call event:", JSON.stringify(reqbody, null, 2));

    if (!reqbody.value || reqbody.value.length === 0) {
      console.log("No call events in request body");
      return;
    }

    const notification = reqbody.value[0];
    const call = notification.resourceData;
    const changeType = notification.changeType;

    if (!call || call.state !== "incoming") {
      console.log(`Call state is not incoming: ${call?.state}, changeType: ${changeType}`);
      return;
    }

    console.log(`Incoming call detected with id: ${call.id}`);

    try {
      const tenantId = call.tenantId;
      const accessToken = await this.getAccessToken(tenantId);

      if (changeType === "created" && call.state === "incoming") {
        console.log(`Processing incoming call ${call.id}`);
        await this.answerCall(call.id, accessToken);
        console.log(`Call ${call.id} answered successfully`);

        // Initialize speech service for transcription
        const speechService = new SpeechService();
        
        // Transcribe existing audio file if it exists
        try {
          const transcription = await speechService.speechToTextFromFile('audio.wav');
          console.log('Transcription from file:', transcription);
          
          if (onTranscriptionCallback && transcription) {
            await onTranscriptionCallback(transcription);
          }
        } catch (transcriptionError) {
          console.error('Error transcribing audio file:', transcriptionError.message);
        }
      } else {
        console.log(`Unhandled call state: ${call.state}, changeType: ${changeType}`);
      }
    } catch (error) {
      console.error("Error handling call:", error.response?.data || error.message);
      throw error;
    }
  }

  async handleSpeechTranscription(transcription, onTranscriptionCallback) {
    try {
      if (!transcription || transcription.trim().length === 0) {
        return;
      }

      console.log('Processing speech transcription', { 
        transcription: transcription,
        length: transcription.length
      });

      if (onTranscriptionCallback) {
        await onTranscriptionCallback(transcription);
      }
    } catch (error) {
      console.error('Error handling speech transcription', { 
        error: error.message,
        transcription: transcription 
      });
      throw error;
    }
  }
}

module.exports = { CallHandlerService };