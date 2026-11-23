#pragma once

#include <stdint.h>

class DebouncedInput {
 public:
  bool update(bool current, uint32_t now) {
    if (current != raw_) {
      raw_ = current;
      changedAt_ = now;
    }
    if (now - changedAt_ >= 35) stable_ = raw_;
    return stable_;
  }

 private:
  uint32_t changedAt_ = 0;
  bool raw_ = false;
  bool stable_ = false;
};

enum class Passage { None, Departure, Arrival };

class DirectionTracker {
 public:
  Passage update(bool inside, bool outside, uint32_t now) {
    if (state_ == State::WaitingForClear) {
      if (inside || outside) {
        clearing_ = false;
      } else if (!clearing_) {
        clearSince_ = now;
        clearing_ = true;
      } else if (now - clearSince_ >= 200) {
        state_ = State::Ready;
      }
      return Passage::None;
    }

    if (state_ == State::Ready) {
      if (inside && outside) {
        waitForClear();
      } else if (inside || outside) {
        firstAt_ = now;
        state_ = inside ? State::InsideFirst : State::OutsideFirst;
      }
      return Passage::None;
    }

    if (now - firstAt_ > 2500) {
      waitForClear();
      return Passage::None;
    }

    const bool movingOut = state_ == State::InsideFirst;
    if (movingOut ? outside : inside) {
      waitForClear();
      return movingOut ? Passage::Departure : Passage::Arrival;
    }

    return Passage::None;
  }

 private:
  enum class State { WaitingForClear, Ready, InsideFirst, OutsideFirst };

  void waitForClear() {
    state_ = State::WaitingForClear;
    clearing_ = false;
  }

  State state_ = State::WaitingForClear;
  bool clearing_ = false;
  uint32_t firstAt_ = 0;
  uint32_t clearSince_ = 0;
};
