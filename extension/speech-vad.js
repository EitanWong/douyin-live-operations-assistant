import {MicVAD} from '@ricky0123/vad-web';
import {createSpeechSegments} from '../src/browser/speech-segments.js';
export const captureSpeech=options=>createSpeechSegments(options,{VAD:MicVAD});
