# NVIDIA narration setup

Use NVIDIA Magpie TTS Multilingual's hosted HTTP endpoint; this is separate from Nebius Token Factory and does not change ShipTested scanner behavior.

Official endpoint and sample: https://build.nvidia.com/nvidia/magpie-tts-multilingual/api

1. Sign in to NVIDIA Build and create/configure a key privately as NVIDIA_API_KEY. Never commit it or send it through ATR.
2. Start with one short narration segment. The default voice is Magpie-Multilingual.EN-US.Aria; NVIDIA_TTS_VOICE can select another voice from NVIDIA's voice catalogue.
3. Run `node scripts/platform/nvidia-voice.mjs narration.txt voice.wav`.
4. Listen to the sample, checking ShipTested, Nebius, Tavily and technical terms. Then generate each scene separately and retime the FFmpeg edit to the actual audio lengths.
5. Keep the synthetic-voice disclosure. Send the revised video for team review before final publication.

The generator validates a WAV response, refuses to overwrite output, times out after 90 seconds and never logs credentials or response bodies. Live hosted synthesis was verified on 27 October 2026 with seven Aria WAV segments. The key was supplied privately through process memory and was not persisted. The revised 116.6-second review video passed full media decoding. Future runs still require a privately supplied key. No GPU deployment or paid plan has been provisioned.
