package mlb

import (
	"testing"
	"time"
)

func TestObservedAtFromFeedUsesPlayEventTimestamp(t *testing.T) {
	ts := "2026-06-26T19:05:12Z"
	feed := &LiveFeed{
		LiveData: LiveData{
			Plays: Plays{
				CurrentPlay: CurrentPlay{
					PlayEvents: []PlayEvent{
						{StartTime: "2026-06-26T19:04:00Z"},
						{EndTime: ts},
					},
				},
			},
		},
	}

	got := observedAtFromFeed(feed)
	want, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(want.UTC()) {
		t.Fatalf("observedAt=%s want=%s", got, want.UTC())
	}
}
