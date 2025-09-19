const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const path = require('path');

class SpeechService {
    constructor() {
        this.speechConfig = null;
        this.recognizer = null;
        this.synthesizer = null;
        this.isRecognizing = false;
        this.pushStream = null; // for real-time audio input
        this.initializeSpeechConfig();
    }

    initializeSpeechConfig() {
        try {
            if (process.env.NODE_ENV === 'test') {
                console.log('Skipping speech service configuration in test environment');
                this.speechConfig = {
                    speechRecognitionLanguage: 'en-US',
                    speechSynthesisVoiceName: 'en-US-JennyNeural'
                };
                return;
            }

            const speechKey = process.env.SPEECH_SERVICE_KEY;
            const speechRegion = process.env.SPEECH_SERVICE_REGION;

            if (!speechKey || !speechRegion) {
                throw new Error('Speech service key and region must be configured');
            }

            this.speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
            this.speechConfig.speechRecognitionLanguage = process.env.SPEECH_LANGUAGE || 'en-US';
            this.speechConfig.speechSynthesisVoiceName = process.env.SPEECH_VOICE_NAME || 'en-US-JennyNeural';
            this.speechConfig.speechSynthesisOutputFormat =
                sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

            console.log('Speech service configuration initialized', {
                region: speechRegion,
                language: this.speechConfig.speechRecognitionLanguage,
                voice: this.speechConfig.speechSynthesisVoiceName
            });

        } catch (error) {
            console.error('Failed to initialize speech configuration', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async speechToTextFromFile(filePath) {
        const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(filePath));
        const conversationTranscriber = new sdk.ConversationTranscriber(this.speechConfig, audioConfig);
        const pushStream = sdk.AudioInputStream.createPushStream();
        fs.createReadStream(filePath).on('data', function (chunk) {
            pushStream.write(chunk.slice());
        }).on('end', function () {
            pushStream.close();
        });
        console.log("Transcribing from: " + filename);
        conversationTranscriber.sessionStarted = function (s, e) {
            console.log("SessionStarted event");
            console.log("SessionId:" + e.sessionId);
        };
        conversationTranscriber.sessionStopped = function (s, e) {
            console.log("SessionStopped event");
            console.log("SessionId:" + e.sessionId);
            conversationTranscriber.stopTranscribingAsync();
        };
        conversationTranscriber.canceled = function (s, e) {
            console.log("Canceled event");
            console.log(e.errorDetails);
            conversationTranscriber.stopTranscribingAsync();
        };
        conversationTranscriber.transcribed = function (s, e) {
            console.log("TRANSCRIBED: Text=" + e.result.text + " Speaker ID=" + e.result.speakerId);
        };
        // Start conversation transcription
        conversationTranscriber.startTranscribingAsync(function () { }, function (err) {
            console.trace("err - starting transcription: " + err);
        });
    }

    /**
     * Feed audio chunk into the push stream.
     * Accepts:
     *  - Buffer (preferred)
     *  - base64 string (will be converted to Buffer)
     *  - ArrayBuffer (will be converted)
     *
     * IMPORTANT: chunk must be in a format the Speech service expects (e.g. PCM 16k/16bit mono).
     */
    feedAudioChunk(chunk) {
        if (!this.pushStream) {
            console.warn('No active push stream to feed audio');
            return;
        }

        try {
            let buf = chunk;
            if (typeof chunk === 'string') {
                // assume base64
                buf = Buffer.from(chunk, 'base64');
            } else if (chunk instanceof ArrayBuffer) {
                buf = Buffer.from(chunk);
            } else if (!Buffer.isBuffer(chunk) && chunk && typeof chunk === 'object' && chunk.buffer instanceof ArrayBuffer) {
                // sometimes frames come as typed arrays
                buf = Buffer.from(chunk.buffer);
            }

            if (!Buffer.isBuffer(buf)) {
                console.warn('Unsupported chunk type passed to feedAudioChunk', typeof chunk);
                return;
            }

            this.pushStream.write(buf);
        } catch (err) {
            console.error('Error writing audio chunk to push stream', { error: err.message });
        }
    }

    async stopContinuousRecognition() {
        try {
            if (!this.isRecognizing || !this.recognizer) {
                console.warn('No continuous recognition to stop');
                // still try to close push stream if present
                if (this.pushStream) {
                    try { this.pushStream.close(); this.pushStream = null; } catch (ex) {}
                }
                return;
            }

            this.recognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('Continuous recognition stopped');
                    this.isRecognizing = false;
                    try { this.recognizer.close(); } catch (ex) {}
                    this.recognizer = null;
                    if (this.pushStream) {
                        try { this.pushStream.close(); } catch (ex) {}
                        this.pushStream = null;
                    }
                },
                (error) => {
                    console.error('Error stopping continuous recognition', { error: (error && error.message) || error });
                    this.isRecognizing = false;
                }
            );

        } catch (error) {
            console.error('Error in stopContinuousRecognition', { error: error.message });
            throw error;
        }
    }

    async textToSpeech(text, voiceName = null) {
        return new Promise((resolve, reject) => {
            try {
                if (process.env.NODE_ENV === 'test') {
                    setTimeout(() => resolve(Buffer.from('fake audio data')), 10);
                    return;
                }

                if (!this.speechConfig || !text) {
                    reject(new Error('Speech configuration not initialized or text is empty'));
                    return;
                }

                if (voiceName) {
                    this.speechConfig.speechSynthesisVoiceName = voiceName;
                }

                const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, null);
                const ssml = this.generateSSML(text, voiceName);

                synthesizer.speakSsmlAsync(
                    ssml,
                    (result) => {
                        try { synthesizer.close(); } catch (e) {}
                        if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                            const audioBuffer = Buffer.from(result.audioData);
                            resolve(audioBuffer);
                        } else {
                            reject(new Error(`Speech synthesis failed: ${result && result.errorDetails}`));
                        }
                    },
                    (error) => {
                        try { synthesizer.close(); } catch (e) {}
                        reject(error);
                    }
                );
            } catch (error) {
                console.error('Error in textToSpeech', { error: error.message });
                reject(error);
            }
        });
    }

    generateSSML(text, voiceName = null) {
        const voice = voiceName || (this.speechConfig && this.speechConfig.speechSynthesisVoiceName) || 'en-US-JennyNeural';
        const cleanText = String(text).replace(/[<>&"']/g, (match) => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            '"': '&quot;',
            "'": '&apos;'
        }[match]));
        return `
            <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
                <voice name="${voice}">
                    <prosody rate="medium" pitch="medium">${cleanText}</prosody>
                </voice>
            </speak>
        `;
    }

    async saveAudioToFile(audioBuffer, filePath) {
        try {
            const fs = require('fs').promises;
            await fs.writeFile(filePath, audioBuffer);
            console.log('Audio saved to file', { filePath, size: audioBuffer.length });
        } catch (error) {
            console.error('Error saving audio to file', { error: error.message, filePath });
            throw error;
        }
    }

    dispose() {
        try {
            if (this.isRecognizing) {
                // don't await here; just attempt to stop
                this.stopContinuousRecognition().catch((e) => console.error('Error stopping during dispose', e));
            }
            if (this.synthesizer) {
                try { this.synthesizer.close(); } catch (e) {}
                this.synthesizer = null;
            }
            this.speechConfig = null;
            console.log('Speech service disposed');
        } catch (error) {
            console.error('Error disposing speech service', { error: error.message });
        }
    }
}

module.exports = { SpeechService };