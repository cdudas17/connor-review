export const TEAM_PR_SEARCH_QUERY = /* GraphQL */ `
  query TeamPRs($q: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 100, after: $after) {
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
          reviewDecision
          baseRefName
          headRefName
          headRefOid
          createdAt
          updatedAt
          labels(first: 10) { nodes { name color } }
          autoMergeRequest { mergeMethod }
          mergeQueueEntry { state position }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(first: 20) {
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
