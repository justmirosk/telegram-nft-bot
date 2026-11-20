const test = require('node:test')
const assert = require('node:assert/strict')
const { renderUrl } = require('./citizenCardCapture')
const wallet = '0x0000000000000000000000000000000000000001'
test('Citizen capture URL targets dedicated card without credentials', () => {
  assert.equal(renderUrl('https://www.beaniscrolls.com/api/connected-accounts/telegram/citizen?secret=bad', wallet),
    'https://www.beaniscrolls.com/telegram/citizen-card/' + wallet)
})
test('Reject invalid wallet', () => {
  assert.throws(() => renderUrl('https://www.beaniscrolls.com', 'bad'))
})
test('Reject non-HTTPS external renderer', () => {
  assert.throws(() => renderUrl('http://example.com', wallet))
})
