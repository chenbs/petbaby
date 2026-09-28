CREATE TABLE fun_test_results (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id text NOT NULL,
  pet_name varchar(24) NOT NULL,
  answers jsonb NOT NULL,
  outcome_id text NOT NULL,
  snapshot jsonb NOT NULL,
  share_token varchar(32) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fun_test_results_owner_recent_idx ON fun_test_results(user_id, created_at DESC);
