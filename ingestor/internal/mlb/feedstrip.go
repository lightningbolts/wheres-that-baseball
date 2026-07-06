package mlb

import "encoding/json"

// stripMlbFeedForStorage removes bulky sections from the live feed JSON before
// persisting to Supabase. Box score lives in games.box_score; player dictionaries
// and season stat blobs are unused for play-by-play replay.
func stripMlbFeedForStorage(raw json.RawMessage) (json.RawMessage, error) {
	var feed map[string]json.RawMessage
	if err := json.Unmarshal(raw, &feed); err != nil {
		return raw, nil
	}

	gameDataRaw, ok := feed["gameData"]
	if !ok {
		return raw, nil
	}

	var gameData map[string]json.RawMessage
	if err := json.Unmarshal(gameDataRaw, &gameData); err != nil {
		return raw, nil
	}

	delete(gameData, "players")
	delete(gameData, "probablePitchers")
	delete(gameData, "weather")
	delete(gameData, "gameInfo")
	delete(gameData, "datetime")
	delete(gameData, "flags")
	delete(gameData, "alerts")

	teamsRaw, ok := gameData["teams"]
	if ok {
		var teams map[string]json.RawMessage
		if err := json.Unmarshal(teamsRaw, &teams); err == nil {
			trimmedTeams := make(map[string]json.RawMessage, len(teams))
			for side, teamRaw := range teams {
				var team map[string]any
				if err := json.Unmarshal(teamRaw, &team); err != nil {
					trimmedTeams[side] = teamRaw
					continue
				}
				trimmed := map[string]any{}
				for _, key := range []string{"id", "name", "abbreviation"} {
					if value, exists := team[key]; exists {
						trimmed[key] = value
					}
				}
				encoded, err := json.Marshal(trimmed)
				if err != nil {
					trimmedTeams[side] = teamRaw
					continue
				}
				trimmedTeams[side] = encoded
			}
			if encoded, err := json.Marshal(trimmedTeams); err == nil {
				gameData["teams"] = encoded
			}
		}
	}

	if encoded, err := json.Marshal(gameData); err == nil {
		feed["gameData"] = encoded
	}

	liveDataRaw, ok := feed["liveData"]
	if ok {
		var liveData map[string]json.RawMessage
		if err := json.Unmarshal(liveDataRaw, &liveData); err == nil {
			delete(liveData, "boxscore")
			delete(liveData, "decisions")
			delete(liveData, "leaders")
			if encoded, err := json.Marshal(liveData); err == nil {
				feed["liveData"] = encoded
			}
		}
	}

	encoded, err := json.Marshal(feed)
	if err != nil {
		return raw, err
	}
	return encoded, nil
}

func wrapMlbFeed(raw json.RawMessage) (json.RawMessage, error) {
	stripped, err := stripMlbFeedForStorage(raw)
	if err != nil {
		stripped = raw
	}

	wrapped, err := json.Marshal(map[string]json.RawMessage{
		"mlbFeed": stripped,
	})
	if err != nil {
		return nil, err
	}
	return wrapped, nil
}
