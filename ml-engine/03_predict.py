from inference import game_state_to_features, predict_from_game_state, predict_steal_from_game_state

if __name__ == "__main__":
    scenarios = [
        ("3-0 count", {"balls": 3, "strikes": 0, "outs": 1, "on_first": True}),
        ("GIDP setup R1 0 outs", {"balls": 0, "strikes": 0, "outs": 0, "on_first": True}),
        ("Sac fly setup R3 0 outs", {"balls": 0, "strikes": 0, "outs": 0, "on_third": True}),
        ("0-2 count", {"balls": 0, "strikes": 2, "outs": 1}),
    ]

    base = {
        "inning": 7,
        "inning_half": "bottom",
        "pitch_count": 3,
        "away_score": 2,
        "home_score": 3,
        "last_pitch_speed": 94.2,
        "last_pitch_type": "SL",
    }

    for label, overrides in scenarios:
        state = {**base, **overrides}
        probs = predict_from_game_state(state)
        print(f"\n{label}:")
        for key in sorted(probs, key=probs.get, reverse=True)[:6]:
            print(f"  {key}: {probs[key]:.3f}")
        print(f"  sum: {sum(probs.values()):.3f}")

    steal_state = {**base, "on_first": True, "on_second": False}
    steal = predict_steal_from_game_state(steal_state)
    print(f"\nSteal odds (runner on 1B): attempt={steal['steal_attempt']:.3f} success={steal['steal_success']:.3f}")

    mapped = game_state_to_features(
        inning=7,
        balls=2,
        strikes=2,
        outs=1,
        on_first=True,
        on_second=False,
        on_third=False,
        inning_half="bottom",
        pitch_count=5,
        away_score=2,
        home_score=3,
        last_pitch_speed=91.0,
        last_pitch_type="FF",
    )
    print(f"\nfeature count: {len(mapped)}")
