// Prototype accounts used when no backend is configured (VITE_ENABLE_DEMO_ACCOUNTS).
// Passwords are stored as SHA-256(email:password) so they don't appear in the
// bundle as plain text. This is still client-side and NOT a substitute for real
// authentication — production must use Supabase Auth (or another server).

export interface DemoAccount {
  email: string;
  hash: string;
  role: 'admin' | 'client';
  partnerId?: string;
  name: string;
  title: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'admin@ssiglobal.com', hash: '8158e510dee4c602fd8d5ecb1b9353f0f413d4f85bfe127eb192f907ca60e02a', role: 'admin', name: 'Aisha Rahman', title: 'Super Admin' },
  { email: 'meera@horizonedu.in', hash: '5684effa5e41196eff5c4095e4de418b2285518336254cbc6f2ddd643835b705', role: 'client', partnerId: 'p1', name: 'Meera Krishnan', title: 'Horizon Edu Consultants' },
  { email: 'rahul@brightpath.co', hash: '76fb842a55efeec825d78aa76ec2f9023654dad5d997dc1fc0a678a899573197', role: 'client', partnerId: 'p2', name: 'Rahul Verma', title: 'BrightPath Overseas' },
  { email: 'fatima@globalscholars.ae', hash: '9f3cc68af2582715aa819d478dd0e97c239df807e998c8d308af52ca7c1e43b6', role: 'client', partnerId: 'p3', name: 'Fatima Sheikh', title: 'Global Scholars Hub' },
  { email: 'anand@pinnaclestudy.in', hash: '6032551077f8f9ed8b1ba64944e8899a71855473e87b5e8f9196d4f5d6151886', role: 'client', partnerId: 'p4', name: 'Anand Pillai', title: 'Pinnacle Study Abroad' },
  { email: 'sanjana@nexusedu.lk', hash: 'f3856f54f92413b6086654bced2f8989a029b14e2ce260dbd440ee97c4721502', role: 'client', partnerId: 'p5', name: 'Sanjana Rao', title: 'Nexus Education Partners' },
  { email: 'daniel@edubridge.np', hash: '55b98400cfa15f8c96ce9e35d5035b06f29f93806241fb9931cdb42857c4a282', role: 'client', partnerId: 'p6', name: 'Daniel Joseph', title: 'EduBridge Global' },
];

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
