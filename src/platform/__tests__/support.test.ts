import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { SUPPORT_URL, isSupportUrl, maybeSupportUrlOf } from '../support'

describe('the tip jar link', () => {
  test('SUPPORT_URL is empty or an https link on buy.stripe.com', () => {
    const url: string = SUPPORT_URL
    expect(url === '' || isSupportUrl(url)).toBe(true)
  })

  test.each([
    'https://buy.stripe.com/test_abc123',
    'https://buy.stripe.com/abc123?prefilled_email=',
  ])('takes %s', url => {
    expect(isSupportUrl(url)).toBe(true)
  })

  test.each([
    '',
    'buy.stripe.com/abc123',
    'http://buy.stripe.com/abc123',
    'https://buy.stripe.com/',
    'https://buy.stripe.co/abc123',
    'https://evil.example/buy.stripe.com/abc123',
    'https://buy.stripe.com.evil.example/abc123',
    'javascript:alert(1)',
  ])('refuses %j', url => {
    expect(isSupportUrl(url)).toBe(false)
  })

  test('an empty link draws no button', () => {
    expect(Option.isNone(maybeSupportUrlOf(''))).toBe(true)
  })
})
