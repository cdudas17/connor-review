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
        baseRefName
        headRefName
        headRefOid
        url
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 50) {
              nodes {
                id
                author { login }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;
