#include <cassert>
#include "../LeaveMateStation/direction.h"

static void clearLane(DirectionTracker& tracker, uint32_t now) {
  assert(tracker.update(false, false, now) == Passage::None);
  assert(tracker.update(false, false, now + 200) == Passage::None);
}

int main() {
  DirectionTracker exit;
  clearLane(exit, 0);
  assert(exit.update(true, false, 300) == Passage::None);
  assert(exit.update(true, true, 450) == Passage::Departure);
  assert(exit.update(false, true, 650) == Passage::None);
  assert(exit.update(true, true, 675) == Passage::None);
  clearLane(exit, 800);
  assert(exit.update(true, false, 1100) == Passage::None);
  assert(exit.update(false, true, 1300) == Passage::Departure);

  DirectionTracker entry;
  clearLane(entry, 0);
  assert(entry.update(false, true, 300) == Passage::None);
  assert(entry.update(true, true, 450) == Passage::Arrival);

  DirectionTracker overlap;
  clearLane(overlap, 0);
  assert(overlap.update(true, true, 300) == Passage::None);
  assert(overlap.update(false, true, 450) == Passage::None);

  DirectionTracker expired;
  clearLane(expired, 0);
  assert(expired.update(true, false, 300) == Passage::None);
  assert(expired.update(false, true, 2801) == Passage::None);

  DirectionTracker wrap;
  clearLane(wrap, UINT32_MAX - 350);
  assert(wrap.update(true, false, UINT32_MAX - 50) == Passage::None);
  assert(wrap.update(false, true, 50) == Passage::Departure);

  DebouncedInput input;
  assert(!input.update(true, 10));
  assert(!input.update(false, 24));
  assert(!input.update(true, 100));
  assert(input.update(true, 135));
  assert(input.update(false, 140));
  assert(!input.update(false, 175));
}
