package mlb

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const scheduleAPIBase = "https://statsapi.mlb.com/api/v1"

// ScheduleGame is metadata for one game returned by the MLB schedule endpoint.
type ScheduleGame struct {
	GamePK           int
	GameDate         string
	Season           int
	GameType         string
	Status           string
	StatusDetail     string
	AwayTeamID       int
	AwayTeamName     string
	AwayTeamAbbrev   string
	HomeTeamID       int
	HomeTeamName     string
	HomeTeamAbbrev   string
	AwayScore        *int
	HomeScore        *int
	VenueID          *int
	VenueName        string
	OfficialDate     string
}

// scheduleResponse is a minimal decode of GET /schedule for game discovery.
type scheduleResponse struct {
	Dates []struct {
		Games []scheduleGameRaw `json:"games"`
	} `json:"dates"`
}

type scheduleGameRaw struct {
	GamePK       int    `json:"gamePk"`
	GameDate     string `json:"gameDate"`
	OfficialDate string `json:"officialDate"`
	Season       string `json:"season"`
	GameType     string `json:"gameType"`
	Status       struct {
		AbstractGameState string `json:"abstractGameState"`
		DetailedState     string `json:"detailedState"`
	} `json:"status"`
	Teams struct {
		Away scheduleTeamSide `json:"away"`
		Home scheduleTeamSide `json:"home"`
	} `json:"teams"`
	Venue *struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"venue"`
}

type scheduleTeamSide struct {
	Score *int `json:"score"`
	Team  struct {
		ID           int    `json:"id"`
		Name         string `json:"name"`
		Abbreviation string `json:"abbreviation"`
	} `json:"team"`
}

// ScheduleDateET returns today's date in YYYY-MM-DD for the America/New_York
// calendar, which MLB uses for schedule queries.
func ScheduleDateET(t time.Time) string {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02")
}

// FetchScheduleGames returns all regular-season games on the given calendar date.
func FetchScheduleGames(ctx context.Context, httpClient *http.Client, date string) ([]ScheduleGame, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	if date == "" {
		date = ScheduleDateET(time.Now())
	}

	endpoint, err := url.Parse(scheduleAPIBase + "/schedule")
	if err != nil {
		return nil, fmt.Errorf("parse schedule url: %w", err)
	}
	q := endpoint.Query()
	q.Set("sportId", "1")
	q.Set("date", date)
	q.Set("gameTypes", "R")
	q.Set("hydrate", "team,linescore,venue")
	endpoint.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build schedule request: %w", err)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch schedule: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("schedule status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload scheduleResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode schedule: %w", err)
	}

	games := make([]ScheduleGame, 0)
	for _, day := range payload.Dates {
		for _, raw := range day.Games {
			games = append(games, mapScheduleGame(raw))
		}
	}

	return games, nil
}

func mapScheduleGame(raw scheduleGameRaw) ScheduleGame {
	gameDate := raw.OfficialDate
	if gameDate == "" && len(raw.GameDate) >= 10 {
		gameDate = raw.GameDate[:10]
	}

	season, _ := strconv.Atoi(raw.Season)

	gameType := raw.GameType
	if gameType == "" {
		gameType = "R"
	}

	game := ScheduleGame{
		GamePK:         raw.GamePK,
		GameDate:       gameDate,
		Season:         season,
		GameType:       gameType,
		Status:         raw.Status.AbstractGameState,
		StatusDetail:   raw.Status.DetailedState,
		AwayTeamID:     raw.Teams.Away.Team.ID,
		AwayTeamName:   raw.Teams.Away.Team.Name,
		AwayTeamAbbrev: raw.Teams.Away.Team.Abbreviation,
		HomeTeamID:     raw.Teams.Home.Team.ID,
		HomeTeamName:   raw.Teams.Home.Team.Name,
		HomeTeamAbbrev: raw.Teams.Home.Team.Abbreviation,
		AwayScore:      raw.Teams.Away.Score,
		HomeScore:      raw.Teams.Home.Score,
		OfficialDate:   gameDate,
	}

	if raw.Venue != nil {
		id := raw.Venue.ID
		game.VenueID = &id
		game.VenueName = raw.Venue.Name
	}

	return game
}

// IsLiveStatus reports whether MLB's abstract game state indicates active play.
func IsLiveStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "live", "in progress":
		return true
	default:
		return false
	}
}

// PreviousScheduleDate returns the calendar day before date (YYYY-MM-DD).
func PreviousScheduleDate(date string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, -1).Format("2006-01-02")
}

// FetchLiveGamePKs returns game primary keys that are currently Live according
// to the MLB schedule endpoint. Checks today and yesterday's ET slates so
// west-coast games after midnight ET are still discovered.
func FetchLiveGamePKs(ctx context.Context, httpClient *http.Client, date string) ([]int, error) {
	if date == "" {
		date = ScheduleDateET(time.Now())
	}

	dates := []string{PreviousScheduleDate(date), date}
	seen := make(map[int]struct{})
	var pks []int

	for _, scheduleDate := range dates {
		games, err := FetchScheduleGames(ctx, httpClient, scheduleDate)
		if err != nil {
			return nil, err
		}
		for _, game := range games {
			if !IsLiveStatus(game.Status) {
				continue
			}
			if _, ok := seen[game.GamePK]; ok {
				continue
			}
			seen[game.GamePK] = struct{}{}
			pks = append(pks, game.GamePK)
		}
	}

	return pks, nil
}

// DiscoverLiveGamePKs fetches currently live game IDs using this client's HTTP pool.
func (c *Client) DiscoverLiveGamePKs(ctx context.Context, date string) ([]int, error) {
	return FetchLiveGamePKs(ctx, c.httpClient, date)
}

// FetchScheduleGames loads the day's schedule using this client's HTTP pool.
func (c *Client) FetchScheduleGames(ctx context.Context, date string) ([]ScheduleGame, error) {
	return FetchScheduleGames(ctx, c.httpClient, date)
}
