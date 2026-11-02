// NVIDIA Magpie hosted API. Keep credentials in the process environment only.
import {readFile,writeFile} from 'node:fs/promises';
const base='https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio';
const key=process.env.NVIDIA_API_KEY;
if(!key){console.error('Set NVIDIA_API_KEY privately before running. No request was sent.');process.exit(2);}
const [input,output]=process.argv.slice(2);
if(!input||!output){console.error('Usage: node scripts/platform/nvidia-voice.mjs narration.txt voice.wav');process.exit(2);}
const text=(await readFile(input,'utf8')).trim();
if(!text||text.length>4000)throw Error('Use a non-empty narration segment under 4000 characters.');
const form=new FormData();for(const [k,v]of Object.entries({text,language:'en-US',voice:process.env.NVIDIA_TTS_VOICE||'Magpie-Multilingual.EN-US.Aria',encoding:'LINEAR_PCM',sample_rate_hz:'44100'}))form.set(k,v);
const r=await fetch(base+'/synthesize',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(90000)});
if(!r.ok){console.error(`NVIDIA synthesis failed: HTTP ${r.status}. No response or credentials logged.`);process.exit(1);}
const audio=Buffer.from(await r.arrayBuffer());
if(audio.length<44||audio.subarray(0,4).toString()!=='RIFF'||audio.subarray(8,12).toString()!=='WAVE')throw Error('Expected WAV audio; output was not saved.');
await writeFile(output,audio,{flag:'wx'});console.log(`Saved WAV audio (${audio.length} bytes).`);
