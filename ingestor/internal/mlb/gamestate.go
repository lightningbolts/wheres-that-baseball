package mlb

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ToGameState projects a LiveFeed into a flat GameState for prediction and persistence.
func ToGameState(gamePK int, feed *LiveFeed) GameState {
	state := GameState{
		GamePK:     gamePK,
		GameStatus: feed.GameData.Status.AbstractGameState,
		ObservedAt: observedAtFromFeed(feed),
	}

	if t, err := time.Parse(time.RFC3339, feed.GameData.DateTime.DateTime); err == nil {
		state.GameDateTime = t
	}

	play := feed.LiveData.Plays.CurrentPlay
	state.BatterID = play.Matchup.Batter.ID
	state.BatterName = play.Matchup.Batter.FullName
	state.PitcherID = play.Matchup.Pitcher.ID
	state.PitcherName = play.Matchup.Pitcher.FullName
	state.BatterHand = handCode(play.Matchup.Batter.BatSide)
	state.PitcherHand = handCode(play.Matchup.Pitcher.PitchHand)

	state.Balls = play.Count.Balls
	state.Strikes = play.Count.Strikes
	state.Outs = play.Count.Outs

	state.Inning = feed.LiveData.Linescore.CurrentInning
	state.InningHalf = feed.LiveData.Linescore.InningState
	if play.About.Inning > 0 {
		state.Inning = play.About.Inning
	}
	if play.About.InningHalf != "" {
		state.InningHalf = play.About.InningHalf
	}

	state.OnFirst, state.OnSecond, state.OnThird = runnersOnBase(play.Runners)

	var pitchEvents []PlayEvent
	for _, ev := range play.PlayEvents {
		if ev.IsPitch {
			pitchEvents = append(pitchEvents, ev)
		}
	}
	state.PitchCount = len(pitchEvents)

	if len(pitchEvents) > 0 {
		last := pitchEvents[len(pitchEvents)-1]
		state.LastPlayEvent = last.PlayID
		if last.PitchData != nil {
			state.LastPitch = &PitchSnapshot{
				PlayID:     last.PlayID,
				StartSpeed: last.PitchData.StartSpeed,
				EndSpeed:   last.PitchData.EndSpeed,
				SzTop:      last.PitchData.StrikeZoneTop,
				SzBot:      last.PitchData.StrikeZoneBottom,
				X:          last.PitchData.Coordinates.X,
				Y:          last.PitchData.Coordinates.Y,
			}
		}
	}

	return state
}

func observedAtFromFeed(feed *LiveFeed) time.Time {
	events := feed.LiveData.Plays.CurrentPlay.PlayEvents
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].EndTime != "" {
			if t, err := time.Parse(time.RFC3339, events[i].EndTime); err == nil {
				return t.UTC()
			}
		}
		if events[i].StartTime != "" {
			if t, err := time.Parse(time.RFC3339, events[i].StartTime); err == nil {
				return t.UTC()
			}
		}
	}
	return time.Now().UTC()
}

func handCode(h *Hand) string {
	if h == nil {
		return ""
	}
	return h.Code
}

// runnersOnBase derives occupied bases from runner movement end positions.
// When the feed is between plays, runner slices may be empty; callers treat
// that as no runners rather than failing the poll.
func runnersOnBase(runners []Runner) (first, second, third bool) {
	for _, r := range runners {
		if r.Movement.End == nil {
			continue
		}
		switch strings.ToUpper(*r.Movement.End) {
		case "1B":
			first = true
		case "2B":
			second = true
		case "3B":
			third = true
		}
	}
	return first, second, third
}

// Fingerprint returns a stable string key representing observable game state.
// We prefer the latest pitch playId when present; otherwise we hash count,
// matchup, inning, and base state so non-pitch changes (new batter, steal) still
// trigger predictions.
func (s GameState) Fingerprint() string {
	if s.LastPlayEvent != "" {
		return fmt.Sprintf("pitch:%s", s.LastPlayEvent)
	}

	parts := []string{
		"state",
		strconv.Itoa(s.GamePK),
		strconv.Itoa(s.Inning),
		s.InningHalf,
		strconv.Itoa(s.BatterID),
		strconv.Itoa(s.PitcherID),
		fmt.Sprintf("%d-%d-%d", s.Balls, s.Strikes, s.Outs),
		fmt.Sprintf("%d-%d-%d", boolToInt(s.OnFirst), boolToInt(s.OnSecond), boolToInt(s.OnThird)),
		strconv.Itoa(s.PitchCount),
	}
	return strings.Join(parts, "|")
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// IsLive reports whether the game is actively in progress.
func (s GameState) IsLive() bool {
	return IsLiveStatus(s.GameStatus)
}
