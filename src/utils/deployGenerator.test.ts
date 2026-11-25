import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeployBundle } from './deployGenerator';
import { DEFAULT_200U_STRATEGY } from './strategyEngine';

test('generateDeployBundle keeps both PRIVATE_KEY and RECIPIENT_ADDRESS strictly backend-only', () => {
  const bundle = generateDeployBundle({
    heliusRpcUrl: 'https://mainnet.helius-rpc.com/?api-key=5641e03b-ad1b-46b8-bd65-97bde80f9c3e',
    strategyConfig: DEFAULT_200U_STRATEGY,
  });

  // Must prompt both inside SSH terminal rather than taking from frontend
  assert.match(bundle.deployScript, /read -s -p/);
  assert.match(bundle.deployScript, /read -p "请输入您的盈利接收 Solana 公钥地址/);
  assert.match(bundle.deployScript, /chmod 600 \.env/);
  assert.match(bundle.envExample, /PRIVATE_KEY=\n/);
  assert.match(bundle.envExample, /RECIPIENT_ADDRESS=\n/);
  assert.match(bundle.botIndexJs, /lite-api\.jup\.ag\/swap\/v1\/quote/);
  assert.match(bundle.botIndexJs, /SystemProgram\.transfer/);
  assert.match(bundle.botIndexJs, /MIN_TVL_USD \|\| 2000000/);
});
