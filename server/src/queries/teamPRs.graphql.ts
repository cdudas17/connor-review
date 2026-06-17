// 50 PRs/page (down from 100) and 10 check contexts/PR (down from 20) — the
// outer search × inner status-context fan-out was reliably timing out GitHub's
// GraphQL layer for big teams (HTTP 504), since 100 × 20 = 2000 nested context
// lookups per page is expensive. The smaller bound still captures Buildkite +
// Trunk merge-queue checks (which tend to land in the first few contexts).
export const TEAM_PR_SEARCH_QUERY = /* GraphQL */ `
  query TeamPRs($q: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          author { login }
          repository { owner { login } name }
          isDraft
          state
          merged
          mergeable
          reviewDecision
          baseRefName
          headRefName
          headRefOid
          createdAt
          updatedAt
          labels(first: 10) { nodes { name color } }
          latestReviews(first: 10) { nodes { state author { login } } }
          autoMergeRequest { mergeMethod }
          mergeQueueEntry { state position }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(first: 10) {
                    nodes {
                      __typename
                      ... on StatusContext { context state targetUrl }
                      ... on CheckRun { name status conclusion detailsUrl }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
