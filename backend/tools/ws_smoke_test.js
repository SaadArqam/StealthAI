const WebSocket = require('ws');

const url = process.env.WS_URL || 'ws://localhost:3000';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Connecting to', url);
  let ws;
  let attempts = 0;
  while (attempts < 10) {
    try {
      ws = new WebSocket(url);
      await new Promise((res, rej) => {
        ws.once('open', res);
        ws.once('error', rej);
        setTimeout(() => rej(new Error('connect timeout')), 2000);
      });
      break;
    } catch (err) {
      attempts++;
      console.log('connect attempt', attempts, 'failed:', err.message);
      await wait(500);
    }
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('Failed to connect');
    process.exit(1);
  }

  ws.on('message', (m) => {
    try {
      
      const s = m.toString();
      try { const j = JSON.parse(s); console.log('RECV JSON:', j); return; } catch(e) {}
      console.log('RECV BIN', m.length);
    } catch (e) {
      console.log('RECV (err)', e);
    }
  });
  
  await wait(300);

  const turnId = 'smoke-' + Date.now();
  console.log('Sending turn_start', turnId);
  ws.send(JSON.stringify({ type: 'turn_start', id: turnId }));

  await wait(200);

  console.log('Sending user_stopped (1)');
  ws.send(JSON.stringify({ type: 'user_stopped', id: turnId }));

  await wait(300);

  console.log('Sending user_stopped (2)');
  ws.send(JSON.stringify({ type: 'user_stopped', id: turnId }));

  await wait(2000);

  ws.close();
  console.log('Client done');
  process.exit(0);
}

run().catch(e=>{console.error(e); process.exit(1);});
