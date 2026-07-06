"""Train a steal attempt classifier from steal_pitches.parquet."""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import classification_report, log_loss
from sklearn.pipeline import Pipeline

from constants import FEATURE_COLS, LEAGUE_DEFAULTS

DATA_PATH = Path(__file__).parent / "data" / "steal_pitches.parquet"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "steal_model.joblib"
METRICS_PATH = MODEL_DIR / "steal_metrics.json"
TEST_FRAC = 0.2
STEAL_LABELS = ["no_steal", "steal_success", "steal_caught"]


def split_by_game(df: pd.DataFrame, test_frac: float = TEST_FRAC) -> tuple[pd.DataFrame, pd.DataFrame]:
    game_dates = (
        df[["game_pk", "game_date"]]
        .drop_duplicates()
        .sort_values("game_date")
    )
    cutoff = int(len(game_dates) * (1 - test_frac))
    train_games = set(game_dates.iloc[:cutoff]["game_pk"])
    test_games = set(game_dates.iloc[cutoff:]["game_pk"])
    return (
        df[df["game_pk"].isin(train_games)].copy(),
        df[df["game_pk"].isin(test_games)].copy(),
    )


def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    features = df[FEATURE_COLS].copy()
    for col in ["on_first", "on_second", "on_third"]:
        features[col] = features[col].astype(int)
    return features


def train() -> dict:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Missing {DATA_PATH}. Run `python 01b_extract_steal_events.py` first."
        )

    df = pd.read_parquet(DATA_PATH)
    train_df, test_df = split_by_game(df)

    X_train = prepare_features(train_df)
    y_train = train_df["steal_label"]
    X_test = prepare_features(test_df)
    y_test = test_df["steal_label"]

    pipeline = Pipeline([
        ("prep", ColumnTransformer(
            transformers=[("num", "passthrough", FEATURE_COLS)],
        )),
        ("clf", HistGradientBoostingClassifier(
            max_depth=5,
            learning_rate=0.1,
            max_iter=150,
            class_weight="balanced",
            random_state=42,
        )),
    ])
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)
    classes = list(pipeline.named_steps["clf"].classes_)
    model_log_loss = float(log_loss(y_test, y_proba, labels=classes))

    print(classification_report(y_test, y_pred, labels=classes, zero_division=0))
    print(f"Steal model log loss: {model_log_loss:.4f}")

    artifact = {
        "pipeline": pipeline,
        "feature_cols": FEATURE_COLS,
        "outcome_keys": classes,
        "league_defaults": dict(LEAGUE_DEFAULTS),
    }
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, MODEL_PATH)

    metrics = {
        "rows_train": len(train_df),
        "rows_test": len(test_df),
        "log_loss": model_log_loss,
        "class_distribution_train": y_train.value_counts(normalize=True).to_dict(),
        "class_distribution_test": y_test.value_counts(normalize=True).to_dict(),
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    print(f"Saved steal model to {MODEL_PATH}")
    return metrics


if __name__ == "__main__":
    train()
