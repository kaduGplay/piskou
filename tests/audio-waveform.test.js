import test from 'node:test'
import assert from 'node:assert/strict'
import { waveformPeaks, audioTime } from '../src/chat/audioWaveform.js'

test('waveform represents actual samples and silence stays flat', () => {
  assert.deepEqual(waveformPeaks(new Float32Array(8), 4), [0, 0, 0, 0])
  assert.deepEqual(waveformPeaks(new Float32Array([0, .5, -.75, .1, 0, 0, 1, -1]), 4), [.5, .75, 0, 1])
  assert.deepEqual(waveformPeaks(new Float32Array(), 3), [0, 0, 0])
})
test('audio clock handles unknown duration, seconds and minutes', () => {
  for (const [value, expected] of [[Infinity, '0:00'], [NaN, '0:00'], [-1, '0:00'], [9.8, '0:09'], [65, '1:05']])
    assert.equal(audioTime(value), expected)
})
