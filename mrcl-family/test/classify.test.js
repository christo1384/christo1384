import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, extractPerson, stripPrefix, stripRedundantTime, toBoardItem } from '../public/js/classify.js';

const NAMES = ['Lili', 'Ruby', 'Max', 'Chris'];
// The real family, longest form first so "Lili" cannot shadow "Liliani".
const MRCL = ['Liliani', 'Lili', 'Morgan', 'Regan', 'Chris'];

test('real entries from the family calendar land in sensible rows', () => {
  assert.equal(classify('Lili Ortho 8.20am'), 'appointment');
  assert.equal(classify('Family outing: Auckland Zoo'), 'family');
  assert.equal(classify('Soccer practice'), 'sport');
  assert.equal(classify('Bins out'), 'chore');
});

test('an unrecognised entry falls back rather than disappearing', () => {
  assert.equal(classify('Twist Lilis plate'), 'appointment');
  assert.equal(classify(''), 'appointment');
  assert.equal(classify(undefined), 'appointment');
  assert.equal(classify('Qwertyuiop', { fallback: 'note' }), 'note');
});

test('the longest matching keyword wins', () => {
  // "party" is a family keyword, "birthday party" is longer and also family;
  // "birthday" alone would otherwise pull it into the birthdays band.
  assert.equal(classify("Ruby's birthday party"), 'family');
  assert.equal(classify('Swimming lesson'), 'sport');
});

test('an explicit prefix beats the keywords', () => {
  assert.equal(classify('Dinner: fish and chips'), 'dinner');
  assert.equal(classify('Note: soccer is cancelled'), 'note');
  assert.equal(classify('Chore - mow lawns'), 'chore');
  assert.equal(classify('Out and about: Nana visiting'), 'out');
});

test('stripPrefix only strips a prefix it recognises', () => {
  assert.deepEqual(stripPrefix('Dinner: lasagne'), { category: 'dinner', title: 'lasagne' });
  assert.deepEqual(stripPrefix('Meeting: with the bank'), { category: null, title: 'Meeting: with the bank' });
  assert.deepEqual(stripPrefix('No prefix here'), { category: null, title: 'No prefix here' });
  assert.deepEqual(stripPrefix(''), { category: null, title: '' });
});

test('keywords match whole words, not fragments', () => {
  // "gp" must not fire inside "Gpsomething", and "tea" not inside "teacher".
  assert.equal(classify('Teacher only day'), 'appointment');
  assert.equal(classify('Tea at Nanas'), 'dinner');
});

test('a leading name is lifted out so the board does not repeat it', () => {
  assert.deepEqual(extractPerson('Lili Ortho', NAMES), { who: 'Lili', title: 'Ortho' });
  assert.deepEqual(extractPerson("Ruby's swimming", NAMES), { who: 'Ruby', title: 'swimming' });
});

test('a name elsewhere in the title is reported but left in place', () => {
  const result = extractPerson('Twist Lilis plate', NAMES);
  assert.equal(result.who, 'Lili');
  assert.equal(result.title, 'Twist Lilis plate');
});

test('extractPerson copes with no match and no names', () => {
  assert.deepEqual(extractPerson('Bins out', NAMES), { who: '', title: 'Bins out' });
  assert.deepEqual(extractPerson('Lili Ortho', []), { who: '', title: 'Lili Ortho' });
  assert.deepEqual(extractPerson('', NAMES), { who: '', title: '' });
});

test('a name that is the whole title is kept as the title', () => {
  assert.deepEqual(extractPerson('Lili', NAMES), { who: 'Lili', title: 'Lili' });
});

test('a time already shown by the board is dropped from the words', () => {
  assert.equal(stripRedundantTime('Lili Ortho 8.20am', true), 'Lili Ortho');
  assert.equal(stripRedundantTime('Soccer 4pm', true), 'Soccer');
  assert.equal(stripRedundantTime('Dentist (9:15am)', true), 'Dentist');
  // No start time on the event, so the words are all there is.
  assert.equal(stripRedundantTime('Lili Ortho 8.20am', false), 'Lili Ortho 8.20am');
  // Never strip away the entire title.
  assert.equal(stripRedundantTime('8.20am', true), '8.20am');
});

test('toBoardItem turns a calendar occurrence into a board row', () => {
  const item = toBoardItem(
    { title: 'Lili Ortho 8.20am', date: '2026-10-27', time: '08:20', uid: 'x' },
    { names: NAMES },
  );
  assert.equal(item.category, 'appointment');
  assert.equal(item.who, 'Lili');
  assert.equal(item.title, 'Ortho');
  assert.equal(item.date, '2026-10-27');
  assert.equal(item.time, '08:20');
});

test('toBoardItem handles a prefixed, all-day entry', () => {
  const item = toBoardItem(
    { title: 'Family outing: Auckland Zoo', date: '2026-10-16', time: '', uid: 'y' },
    { names: NAMES },
  );
  assert.equal(item.category, 'family');
  assert.equal(item.title, 'Auckland Zoo');
  assert.equal(item.who, '');
});

test('a feed pinned to one row overrides the classifier', () => {
  const item = toBoardItem(
    { title: 'Soccer practice', date: '2026-10-16', time: '16:00', uid: 'z' },
    { names: NAMES, defaultCategory: 'note' },
  );
  assert.equal(item.category, 'note');
});

test('the real family calendar, entry by entry', () => {
  const cases = [
    // [title, time, expected category, expected who, expected title]
    ['Lili Ortho 8.20am', '08:20', 'appointment', 'Lili', 'Ortho'],
    ['Liliani ortho appt 9am', '09:00', 'appointment', 'Liliani', 'ortho appt'],
    ['Lili eye appointment super clinic 12:45', '10:30', 'appointment', 'Lili', 'eye appointment super clinic 12:45'],
    ['Regan physio 3pm', '15:00', 'appointment', 'Regan', 'physio'],
    ['Family outing: Auckland Zoo', '', 'family', '', 'Auckland Zoo'],
    ['Twist Lilis plate', '', 'appointment', 'Lili', 'Twist Lilis plate'],
  ];

  for (const [title, time, category, who, expected] of cases) {
    const item = toBoardItem({ title, time, date: '2026-10-27', uid: 'x' }, { names: MRCL });
    assert.equal(item.category, category, title);
    assert.equal(item.who, who, title);
    assert.equal(item.title, expected, title);
  }
});

test('an entry about two people keeps its wording', () => {
  const item = toBoardItem(
    { title: 'Morgan and Chris eye appointment', time: '13:00', date: '2026-07-25', uid: 'y' },
    { names: MRCL },
  );
  assert.equal(item.category, 'appointment');
  assert.equal(item.who, 'Morgan');
  // Not "and Chris eye appointment".
  assert.equal(item.title, 'Morgan and Chris eye appointment');
});

test('a short name does not shadow a longer one that starts the same way', () => {
  assert.deepEqual(extractPerson('Liliani ortho', MRCL), { who: 'Liliani', title: 'ortho' });
  assert.deepEqual(extractPerson('Lili ortho', MRCL), { who: 'Lili', title: 'ortho' });
});

test('toBoardItem never produces an empty title', () => {
  const item = toBoardItem({ title: 'Lili', date: '2026-10-16', time: '', uid: 'w' }, { names: NAMES });
  assert.equal(item.title, 'Lili');
  assert.equal(item.who, 'Lili');
});
