export const PULL_REQUEST_QUERY = /* GraphQL */ `
  query PullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        number
        title
        author { login }
        state
        merged
        isDraft
        reviewDecision
        baseRefName
        headRefName
        headRefOid
        url
        createdAt
        bodyHTML
        viewerLatestReview { id state }
        labels(first: 50) { nodes { name color } }
        assignees(first: 20) { nodes { login avatarUrl url } }
        reviews(first: 100) {
          nodes {
            id
            state
            body
            bodyHTML
            author { login avatarUrl }
            createdAt
            url
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
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
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 50) {
              nodes {
                id
                author { login avatarUrl }
                body
                createdAt
                diffHunk
              }
            }
          }
        }
      }
    }
  }
`;
