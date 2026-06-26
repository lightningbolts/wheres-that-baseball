// Package mlb encapsulates the MLB Stats API domain: HTTP transport, JSON
// unmarshaling into typed structs, polling, and in-memory state diffing.
package mlb

import "time"

// LiveFeed is the top-level response from GET /game/{gamePk}/feed/live.
// We intentionally model only the subtrees required for at-bat prediction so
// unmarshaling stays fast and memory footprint low on hot polling paths.
type LiveFeed struct {
	GameData GameData `json:"gameData"`
	LiveData LiveData `json:"liveData"`
}

// GameData carries metadata about the game itself (status, schedule).
type GameData struct {
	Status   GameStatus `json:"status"`
	DateTime GameDateTime `json:"datetime"`
}

// GameStatus mirrors MLB's abstract/detailed state machine.
type GameStatus struct {
	AbstractGameState string `json:"abstractGameState"` // Preview, Live, Final
	DetailedState     string `json:"detailedState"`
	StatusCode        string `json:"statusCode"`
}

// GameDateTime holds scheduled or actual start time.
type GameDateTime struct {
	DateTime string `json:"dateTime"`
}

// LiveData is the in-progress snapshot: scoring line and play-by-play.
type LiveData struct {
	Plays     Plays     `json:"plays"`
	Linescore Linescore `json:"linescore"`
}

// Linescore provides the current inning context and team totals.
type Linescore struct {
	CurrentInning int             `json:"currentInning"`
	InningState   string          `json:"inningState"` // Top, Bottom, Middle, End
	Teams         LinescoreTeams  `json:"teams"`
}

// LinescoreTeams holds runs (and other totals) for each side.
type LinescoreTeams struct {
	Away TeamLine `json:"away"`
	Home TeamLine `json:"home"`
}

// TeamLine is one team's line in the linescore.
type TeamLine struct {
	Runs int `json:"runs"`
}

// Plays contains the active at-bat and historical plays.
type Plays struct {
	CurrentPlay CurrentPlay `json:"currentPlay"`
}

// CurrentPlay is the at-bat currently in progress (or last completed if between batters).
type CurrentPlay struct {
	Matchup    Matchup     `json:"matchup"`
	Count      Count       `json:"count"`
	Runners    []Runner    `json:"runners"`
	PlayEvents []PlayEvent `json:"playEvents"`
	About      PlayAbout   `json:"about"`
}

// PlayAbout includes inning metadata for the play.
type PlayAbout struct {
	Inning     int    `json:"inning"`
	InningHalf string `json:"halfInning"` // top, bottom
	IsTopInning bool  `json:"isTopInning"`
}

// Matchup identifies the batter and pitcher for the current plate appearance.
type Matchup struct {
	Batter  PlayerRef `json:"batter"`
	Pitcher PlayerRef `json:"pitcher"`
}

// PlayerRef is a minimal player identity used in live feed matchups.
type PlayerRef struct {
	ID       int    `json:"id"`
	FullName string `json:"fullName"`
	BatSide  *Hand  `json:"batSide,omitempty"`
	PitchHand *Hand `json:"pitchHand,omitempty"`
}

// Hand encodes L/R/S handedness codes from the API.
type Hand struct {
	Code string `json:"code"`
}

// Count is balls, strikes, and outs for the current at-bat / half-inning context.
type Count struct {
	Balls   int `json:"balls"`
	Strikes int `json:"strikes"`
	Outs    int `json:"outs"`
}

// Runner describes a baserunner's position during the current play.
type Runner struct {
	Movement RunnerMovement `json:"movement"`
}

// RunnerMovement captures where a runner started and ended on the play.
type RunnerMovement struct {
	Start *string `json:"start"` // e.g. "1B", "2B", "3B", or null if at plate
	End   *string `json:"end"`   // base occupied after the event
}

// EventCount is balls/strikes/outs after a play event.
type EventCount struct {
	Balls   int `json:"balls"`
	Strikes int `json:"strikes"`
	Outs    int `json:"outs"`
}

// PlayEvent is a single pitch or action within the current at-bat.
type PlayEvent struct {
	PlayID    string      `json:"playId"`
	IsPitch   bool        `json:"isPitch"`
	PitchData *PitchData  `json:"pitchData,omitempty"`
	Count     *EventCount `json:"count,omitempty"`
	Index     int         `json:"index"`
	StartTime string      `json:"startTime,omitempty"`
	EndTime   string      `json:"endTime,omitempty"`
}

// PitchData holds Statcast-style measurements for a pitch.
type PitchData struct {
	StartSpeed float64        `json:"startSpeed"`
	EndSpeed   float64        `json:"endSpeed"`
	Coordinates PitchCoordinates `json:"coordinates"`
	StrikeZoneTop float64     `json:"strikeZoneTop"`
	StrikeZoneBottom float64  `json:"strikeZoneBottom"`
}

// PitchCoordinates locates the pitch at the plate (feet from origin).
type PitchCoordinates struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// GameState is a flattened, domain-friendly snapshot derived from LiveFeed.
// Downstream packages (predictor, database) depend on GameState rather than
// raw API structs, insulating them from JSON schema churn.
type GameState struct {
	GamePK        int
	GameStatus    string
	GameDateTime  time.Time
	Inning        int
	InningHalf    string
	BatterID      int
	BatterName    string
	BatterHand    string
	PitcherID     int
	PitcherName   string
	PitcherHand   string
	Balls         int
	Strikes       int
	Outs          int
	OnFirst       bool
	OnSecond      bool
	OnThird       bool
	LastPitch     *PitchSnapshot
	LastPlayEvent string // playId of the most recent pitch event
	PitchCount    int    // number of pitch events in current at-bat
	ObservedAt    time.Time
}

// PitchSnapshot summarizes the latest pitch for persistence / UI.
type PitchSnapshot struct {
	PlayID     string
	StartSpeed float64
	EndSpeed   float64
	SzTop      float64
	SzBot      float64
	X          float64
	Y          float64
}
