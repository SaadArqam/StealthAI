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

      // capturing raw audio files
      const processor=audioContext.createScriptProcessor(4096,1,1)
      source.connect(processor)
      processor.connect(audioContext.destination)

      processor.onaudioprocess=(e)=>{
        const input=e.inputBuffer.getChannelData(0);
        console.log("Audio frame", input.length)
        let sum = 0;


        // sanity check
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
