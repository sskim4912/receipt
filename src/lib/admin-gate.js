// Test-only screen lock. Public Firestore rules mean this is NOT authorization.
function bytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2)
    throw new Error('화면 잠금 설정을 확인해주세요.');
  return Uint8Array.from(hex.match(/.{2}/g).map((s) => parseInt(s, 16)));
}
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export async function makeGate(password) {
  if (password.length < 12 || password.length > 128)
    throw new Error('관리자 비밀번호는 12~128자로 입력해주세요.');
  const salt = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const iterations = 210000;
  return {
    salt,
    iterations,
    algorithm: 'PBKDF2-SHA256',
    hash: await derive(password, salt, iterations),
    testOnly: true,
  };
}
export async function verifyGate(password, gate) {
  if (
    gate.algorithm !== 'PBKDF2-SHA256' ||
    !Number.isInteger(gate.iterations) ||
    gate.iterations < 100000 ||
    gate.iterations > 1000000 ||
    typeof gate.hash !== 'string' ||
    gate.hash.length !== 64 ||
    typeof gate.salt !== 'string' ||
    gate.salt.length !== 32
  )
    throw new Error('화면 잠금 설정을 확인해주세요.');
  return (await derive(password, gate.salt, gate.iterations)) === gate.hash;
}
