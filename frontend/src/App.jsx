import React from 'react'
import { useEffect } from 'react'

const App = () => {
  useEffect(()=>{
    async function initMic(){

      // mic permission
      const stream=await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Audio permission granted!!!")

      // noisse supression
      const audioContext=new AudioContext({
        sampleRate:16000,
      })

      const source=audioContext.createMediaStreamSource(stream)
      console.log("AudioContext sample rate:", audioContext.sampleRate);

      // capturing raw audio files (input is Float32Array)
      const processor=audioContext.createScriptProcessor(4096,1,1)
      source.connect(processor)
      processor.connect(audioContext.destination)

      processor.onaudioprocess=(e)=>{
        const input=e.inputBuffer.getChannelData(0);
        console.log("Audio frame", input.length)
        
      // converting Float32 into int16 PCM
      function floatTo16BitPCM(float32Array){
        const buffer=new ArrayBuffer(float32Array.length*2)
        const view=new DataView(buffer);

        let offset=0
        for (let i=0;i<float32Array.length;i++,offset+=2){
          let sample=Math.max(-1,Math.min(1,float32Array[i]))
          view.setInt16(offset,sample<0?sample*0x8000 : sample * 0x7fff, true)
        }
        return buffer
      }

      processor.onaudioprocess=(e)=>{
      const input = e.inputBuffer.getChannelData(0);
      const pcmBuffer = floatTo16BitPCM(input);
    };

    // connectind websocket with backend 
    const socket = new WebSocket("ws://localhost:8080");
    socket.onopen = () => {
      console.log("WebSocket connected");
    };


    // streaming audio to backend
    processor.onaudioprocess = (event) => {
    if (socket.readyState !== WebSocket.OPEN) return;

    const input = event.inputBuffer.getChannelData(0);
    const pcmBuffer = floatTo16BitPCM(input);

    socket.send(pcmBuffer);
  };


        
        // sanity check
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += Math.abs(input[i]);
        }
        console.log("Energy:", sum / input.length);
      }
    }

    initMic()
  },[])
  return (
    <div>
      <h1>Voice Assistant</h1>
    </div>
  )
}

export default App
