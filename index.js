// index.js is used to setup and configure your bot

// Import required packages
const express = require("express");

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const { authorizeJWT, CloudAdapter, loadAuthConfigFromEnv } = require("@microsoft/agents-hosting");
const { teamsBot, handleCallEvent } = require("./teamsBot");
const { SpeechService } = require('./speechService');

// Create authentication configuration
const authConfig = loadAuthConfigFromEnv();
const speechService = new SpeechService();
// Create adapter
const adapter = new CloudAdapter(authConfig);
console.log('Created CloudAdapter');
console.log('Adapter created with appId:', authConfig.clientId);

adapter.onTurnError = async (context, error) => {
  console.error("[onTurnError] unhandled error:", error); // log the whole error object
  if (context.activity.type === "message") {
    await context.sendActivity(`The bot encountered an unhandled error:\n ${error && error.message ? error.message : error}`);
    await context.sendActivity("To continue to run this bot, please fix the bot source code.");
  }
};

// Create express application.
const expressApp = express();
expressApp.use(express.json());
//expressApp.use(authorizeJWT(authConfig));

const port = process.env.port || process.env.PORT || 3978;
const server = expressApp.listen(port, () => {
  console.log(
    `Bot Started, listening to port ${port} for appId ${authConfig.clientId} debug ${process.env.DEBUG}`
  );
});

// Listen for incoming requests.
expressApp.post("/api/messages", async (req, res) => {
  console.log('Hi, I am inside api/messages');
  console.log('Request body:', req.body);
  await adapter.process(req, res, async (context) => {
    console.log('Hi, I am inside adapter.process');
    await teamsBot.run(context);
  });
});

expressApp.post("/calling/callback", async (req, res) => {
  try {    
    await adapter.process(req, res, async (context) => {
    console.log('Hi, I am inside adapter.process');
    await handleCallEvent(req.body, context);
  });   
    
    //res.sendStatus(200);
  } catch (error) {
    console.error("Error handling call event:", error);
    res.status(500).send("Error processing call event");
  }
});

// async function tryExtractAndFeed(obj) {
//   // utility to normalize and feed a base64/string/ArrayBuffer/Buffer
//   function feedIfFound(payload, sourceDesc) {
//     if (!payload) return false;
//     try {
//       // if it's an array of packets, process each entry
//       if (Array.isArray(payload)) {
//         payload.forEach(p => feedIfFound(p, sourceDesc + '[]'));
//         return true;
//       }
 
//       // if object has .data or .content or .body - these are likely base64
//       const possibleFields = ['data', 'content', 'body', 'audio', 'chunk', 'payload'];
//       for (const f of possibleFields) {
//         if (payload[f]) {
//           let chunk = payload[f];
//           // if chunk is base64 string
//           if (typeof chunk === 'string') {
//             const buf = Buffer.from(chunk, 'base64');
//             console.log(`Feeding audio chunk from ${sourceDesc}.${f} (bytes=${buf.length})`);
//             speechService.feedAudioChunk(buf);
//             return true;
//           }
//           // ArrayBuffer / typed array / Buffer
//           if (chunk instanceof ArrayBuffer || Buffer.isBuffer(chunk) || (chunk.buffer && chunk.buffer instanceof ArrayBuffer)) {
//             const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer || chunk);
//             console.log(`Feeding audio chunk from ${sourceDesc}.${f} (bytes=${buf.length})`);
//             speechService.feedAudioChunk(buf);
//             return true;
//           }
//         }
//       }
 
//       // Sometimes the object itself is a base64 string
//       if (typeof payload === 'string') {
//         const buf = Buffer.from(payload, 'base64');
//         console.log(`Feeding audio chunk from ${sourceDesc} (bytes=${buf.length})`);
//         speechService.feedAudioChunk(buf);
//         return true;
//       }
 
//       // Some payloads carry `mediaChunks` or `mediaPackets`
//       if (payload.mediaChunks || payload.mediaPackets) {
//         const arr = payload.mediaChunks || payload.mediaPackets;
//         return feedIfFound(arr, sourceDesc + '.mediaChunks');
//       }
 
//       // If payload contains mediaStreams array (metadata only) check if frames are embedded inside
//       if (payload.mediaStreams && Array.isArray(payload.mediaStreams)) {
//         // metadata; nothing to feed directly, but sometimes sibling fields contain data
//         console.log('mediaStreams metadata found:', payload.mediaStreams.map(s => s.label).join(', '));
//       }
 
//       // No recognized payload
//       return false;
//     } catch (ex) {
//       console.error('Error extracting/feeding chunk', ex);
//       return false;
//     }
//   }
 
//   // Try several likely places in descending order
//   if (feedIfFound(obj, 'root')) return;
//   if (obj.resourceData && feedIfFound(obj.resourceData, 'resourceData')) return;
//   if (obj.media && feedIfFound(obj.media, 'media')) return;
//   if (obj.body && feedIfFound(obj.body, 'body')) return;
//   if (obj.data && feedIfFound(obj.data, 'data')) return;
 
//   // If nothing matched, log the object for inspection
//   console.log('No media payload extracted from event; full object for debugging:', JSON.stringify(obj, null, 2));
// }

// // Gracefully shutdown HTTP server
// ["exit", "uncaughtException", "SIGINT", "SIGTERM", "SIGUSR1", "SIGUSR2"].forEach((event) => {
//   process.on(event, () => {
//     server.close();
//   });
// });

// const body = req.body || {};
//     console.log('CALLBACK headers:', req.headers);
//     console.log('CALLBACK body keys:', Object.keys(body));
//     console.log('CALLBACK body sample:', JSON.stringify(body.value?.[0] || body, null, 2));
 
//     // respond quickly so Graph doesn't retry
//     res.status(202).send();
 
//     // Process each notification in the batch
//     const notifications = body.value || [];
//     for (const ev of notifications) {
//       // always log the resource path to see event type
//       console.log('Notification resource:', ev.resource, 'changeType:', ev.changeType);
 
//       // 1) If resource indicates media, try to parse payload
//       if (ev.resource && ev.resource.toLowerCase().includes('/media')) {
//         console.log('Media notification detected:', ev.resource);
//         await tryExtractAndFeed(ev.resourceData || ev);
//         continue;
//       }
 
//       // 2) Some notifications carry media under resourceData.media or resourceData.mediaStreams or resourceData.content
//       if (ev.resourceData && (ev.resourceData.media || ev.resourceData.mediaStreams || ev.resourceData.content || ev.resourceData.data)) {
//         console.log('Possible inlined media in resourceData');
//         await tryExtractAndFeed(ev.resourceData);
//         continue;
//       }
 
//       // 3) Some implementations deliver media in a sub-object (ev.media, ev.body, ev.data)
//       if (ev.media || ev.body || ev.data) {
//         console.log('Possible media under top-level media/body/data');
//         await tryExtractAndFeed(ev);
//         continue;
//       }
 
//       // otherwise this notification is likely lifecycle (created/established/terminated)
//       console.log('Non-media notification (lifecycle):', ev.changeType, ev.resource);
//     }
