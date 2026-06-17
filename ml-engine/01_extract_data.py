import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client

# Load Environment Variables
load_dotenv()
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

def map_outcome(event_type):
    """Maps raw MLB API pitch outcomes to our 4 target categories"""
    if not event_type:
        return 'Other'
        
    event_type = event_type.lower()
    if event_type in ['strikeout', 'strikeout_double_play']:
        return 'Strikeout'
    elif event_type in ['walk', 'intentional_walk']:
        return 'Walk'
    elif event_type in ['single', 'double', 'triple', 'home_run']:
        return 'Hit'
    elif event_type in ['field_out', 'force_out', 'grounded_into_dp', 'fly_out', 'line_out', 'pop_out']:
        return 'Out_In_Play'
    
    return 'Other'

def fetch_ml_data():
    print("Fetching game JSONs from Supabase...")
    
    # Query the games table where we successfully synced the game_state JSON
    # Grabbing 100 games to start.
    response = supabase.table("games").select("game_pk, game_state").not_.is_("game_state", "null").limit(100).execute()
    
    print(f"Retrieved {len(response.data)} games. Flattening JSON into pitches...")
    
    all_pitches = []
    
    # Loop through every game
    for game in response.data:
        game_pk = game['game_pk']
        state = game['game_state']
        
        # Navigate the standard MLB Stats API JSON structure
        try:
            # The play-by-play array is usually nested here
            plays = state.get('liveData', {}).get('plays', {}).get('allPlays', [])
            
            for play in plays:
                # Matchup & Game State Context
                pitcher_id = play.get('matchup', {}).get('pitcher', {}).get('id')
                batter_id = play.get('matchup', {}).get('batter', {}).get('id')
                inning = play.get('about', {}).get('inning')
                
                # Loop through every event (pitch) in the at-bat
                play_events = play.get('playEvents', [])
                for event in play_events:
                    
                    # We only care about actual pitches
                    if event.get('isPitch'):
                        
                        # Get the count BEFORE this pitch was thrown
                        count = event.get('count', {})
                        balls = count.get('balls', 0)
                        strikes = count.get('strikes', 0)
                        outs = count.get('outs', 0)
                        
                        # Did this pitch end the at-bat? If so, what was the result?
                        is_last_pitch = event.get('details', {}).get('isOut') is not None or event.get('details', {}).get('hasReview')
                        # The final result of the at-bat is usually stored on the main 'play' object
                        event_result = play.get('result', {}).get('eventType', '') if is_last_pitch else 'Other'
                        
                        row = {
                            'game_pk': game_pk,
                            'pitcher_id': pitcher_id,
                            'batter_id': batter_id,
                            'inning': inning,
                            'balls': balls,
                            'strikes': strikes,
                            'outs': outs,
                            'outcome_label': map_outcome(event_result)
                        }
                        all_pitches.append(row)
                        
        except Exception as e:
            print(f"Skipping game {game_pk} due to parsing error: {e}")
            continue

    # Convert the flat list of dictionaries into a Pandas DataFrame
    df = pd.DataFrame(all_pitches)
    
    # Clean the Data
    # Drop intermediate pitches that didn't end an at-bat ('Other')
    df = df[df['outcome_label'] != 'Other']
    df = df.dropna()
    
    print(f"Successfully flattened and cleaned {len(df)} at-bat outcomes!")
    
    # Split into Features (X) and Target (Y)
    features = ['inning', 'outs', 'balls', 'strikes']
    X = df[features]
    Y = df['outcome_label']
    
    return X, Y, df

if __name__ == "__main__":
    X, Y, raw_df = fetch_ml_data()
    
    if len(raw_df) > 0:
        print("\nFeature Matrix (X) Sample:")
        print(X.head())
        
        print("\nTarget Outcomes (Y) Distribution:")
        print(Y.value_counts(normalize=True))
    else:
        print("No valid at-bats found. Check JSON key paths.")