export const TEAM_PR_SEARCH_QUERY = /* GraphQL */ `
  query TeamPRs($q: String!) {
    search(query: $q, type: ISSUE, first: 100) {
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
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup { state }
              }
            }
          }
        }
      }
    }
  }
`;
