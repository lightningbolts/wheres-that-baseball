import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import classification_report, f1_score, log_loss
from sklearn.pipeline import Pipeline

from constants import FEATURE_COLS, LEAGUE_DEFAULTS, OUTCOME_KEYS

DATA_PATH = Path(__file__).parent / "data" / "at_bat_pitches.parquet"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "at_bat_model.joblib"
METRICS_PATH = MODEL_DIR / "metrics.json"
TEST_FRAC = 0.2


def split_by_game(df: pd.DataFrame, test_frac: float = TEST_FRAC) -> tuple[pd.DataFrame, pd.DataFrame]:
    game_dates = (
        df[["game_pk", "game_date"]]
        .drop_duplicates()
        .sort_values("game_date")
    )
    cutoff = int(len(game_dates) * (1 - test_frac))
    train_games = set(game_dates.iloc[:cutoff]["game_pk"])
    test_games = set(game_dates.iloc[cutoff:]["game_pk"])

    train = df[df["game_pk"].isin(train_games)].copy()
    test = df[df["game_pk"].isin(test_games)].copy()
    return train, test


def prepare_features(df: pd.DataFrame) -> pd.DataFrame:
    features = df[FEATURE_COLS].copy()
    for col in ["on_first", "on_second", "on_third"]:
        features[col] = features[col].astype(int)
    return features


def baseline_log_loss(y: pd.Series, train_y: pd.Series) -> float:
    """Naive baseline: predict training-set class proportions for every row."""
    counts = train_y.value_counts(normalize=True)
    present_labels = [label for label in OUTCOME_KEYS if label in counts.index]
    uniform = pd.DataFrame(
        {label: counts.get(label, 0.0) for label in present_labels},
        index=y.index,
    )
    return float(log_loss(y, uniform, labels=present_labels))


def train() -> dict:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Missing {DATA_PATH}. Run `python 01_extract_data.py` first."
        )

    df = pd.read_parquet(DATA_PATH)
    print(f"Loaded {len(df)} pitch snapshots from {df['game_pk'].nunique()} games")

    train_df, test_df = split_by_game(df)
    print(f"Train: {len(train_df)} rows ({train_df['game_pk'].nunique()} games)")
    print(f"Test:  {len(test_df)} rows ({test_df['game_pk'].nunique()} games)")

    X_train = prepare_features(train_df)
    y_train = train_df["outcome_label"]
    X_test = prepare_features(test_df)
    y_test = test_df["outcome_label"]

    pipeline = Pipeline([
        ("prep", ColumnTransformer(
            transformers=[("num", "passthrough", FEATURE_COLS)],
        )),
        ("clf", HistGradientBoostingClassifier(
            max_depth=6,
            learning_rate=0.1,
            max_iter=200,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)
    classes = list(pipeline.named_steps["clf"].classes_)

    model_log_loss = float(log_loss(y_test, y_proba, labels=classes))
    naive_log_loss = baseline_log_loss(y_test, y_train)

    print("\nClassification report:")
    print(classification_report(y_test, y_pred, labels=classes, zero_division=0))
    print(f"Model log loss:  {model_log_loss:.4f}")
    print(f"Naive log loss:  {naive_log_loss:.4f}")

    hit_keys = ["single", "double", "triple", "home_run"]
    ob_keys = hit_keys + ["walk", "hit_by_pitch"]
    class_idx = {c: i for i, c in enumerate(classes)}
    mean_hit = sum(y_proba[:, class_idx[k]].mean() for k in hit_keys if k in class_idx)
    mean_ob = sum(y_proba[:, class_idx[k]].mean() for k in ob_keys if k in class_idx)
    macro_f1 = float(f1_score(y_test, y_pred, labels=classes, average="macro", zero_division=0))
    per_class_f1 = {
        label: float(f1_score(y_test == label, y_pred == label, zero_division=0))
        for label in classes
    }
    print(f"Mean predicted P(hit):     {mean_hit:.3f}")
    print(f"Mean predicted P(on base): {mean_ob:.3f}")
    print(f"Macro F1:                  {macro_f1:.4f}")

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
        "games_train": int(train_df["game_pk"].nunique()),
        "games_test": int(test_df["game_pk"].nunique()),
        "log_loss": model_log_loss,
        "naive_log_loss": naive_log_loss,
        "mean_predicted_hit": mean_hit,
        "mean_predicted_on_base": mean_ob,
        "macro_f1": macro_f1,
        "per_class_f1": per_class_f1,
        "class_distribution_train": y_train.value_counts(normalize=True).to_dict(),
        "class_distribution_test": y_test.value_counts(normalize=True).to_dict(),
        "support_test": {k: int((y_test == k).sum()) for k in OUTCOME_KEYS},
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))

    print(f"\nSaved model to {MODEL_PATH}")
    print(f"Saved metrics to {METRICS_PATH}")
    return metrics


if __name__ == "__main__":
    train()
