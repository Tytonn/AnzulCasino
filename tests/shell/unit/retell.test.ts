/**
 * Work, slut and crime results post for everyone, with the flavor line
 * retold about the player (Tyton, Nov 22, 2026). Every default line has to
 * read as plain English once retold.
 */
import { describe, expect, it } from 'vitest'

import { retellLine } from '../../../shared/chat.ts'
import {
  CRIME_FINE_LINES,
  CRIME_WIN_LINES,
  HUSTLE_FINE_LINES,
  HUSTLE_WIN_LINES,
  WORK_LINES,
} from '../../../shared/config-lines.ts'

describe('retellLine', () => {
  it('puts the name where the line says you, and they or them after it', () => {
    expect(retellLine('You parked cars for the high rollers.', 'tyton')).toBe(
      'tyton parked cars for the high rollers.',
    )
    expect(retellLine('Security walked you out of the VIP lounge.', 'Bob')).toBe(
      'Security walked Bob out of the VIP lounge.',
    )
    expect(retellLine('Your getaway driver left without you.', 'Bob')).toBe(
      "Bob's getaway driver left without them.",
    )
    expect(retellLine('The spa charged you for the champagne you thought was free.', 'Ann')).toBe(
      'The spa charged Ann for the champagne they thought was free.',
    )
    expect(retellLine('You bought a round. You are not rich.', 'Ann')).toBe(
      'Ann bought a round. They are not rich.',
    )
  })

  it('keeps the verb right after the name', () => {
    expect(retellLine('You were the birthday surprise.', 'Ann')).toBe(
      'Ann was the birthday surprise.',
    )
    expect(retellLine("You're on the list.", 'Ann')).toBe('Ann is on the list.')
  })

  it('leaves a line with no you as it is', () => {
    expect(retellLine('The tourist was an undercover cop.', 'Ann')).toBe(
      'The tourist was an undercover cop.',
    )
  })

  it('leaves no you in any default line', () => {
    const all = [
      ...WORK_LINES,
      ...HUSTLE_WIN_LINES,
      ...HUSTLE_FINE_LINES,
      ...CRIME_WIN_LINES,
      ...CRIME_FINE_LINES,
    ]
    for (const line of all) {
      const told = retellLine(line, 'Ann')
      expect(told, line).not.toMatch(/\byou(r|rs|rself|'re|'ve|'d)?\b/i)
      if (/^your?\b/i.test(line)) expect(told, line).toMatch(/^Ann\b/)
    }
  })
})
