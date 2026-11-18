const test = require('node:test');
const assert = require('node:assert/strict');
const { publicProfile, cardImageUrl, registerCitizenCommand } = require('../citizenCommand');
const wallet = '0x' + 'a'.repeat(40);
test('profile link uses the supplied public wallet', () => assert.equal(publicProfile(wallet), 'https://beaniscrolls.com/citizens/' + wallet));
test('invalid wallets are rejected', () => assert.throws(() => publicProfile('not-a-wallet')));
test('card endpoint is disabled by default', () => { if (!process.env.CITIZEN_CARD_IMAGE_ENDPOINT) assert.equal(cardImageUrl(wallet), null); });
test('registers citizen command', () => { let regex; registerCitizenCommand({ onText: (r) => { regex = r; } }); assert.ok(regex.test('/citizen ' + wallet)); assert.ok(regex.test('/citizen')); });
