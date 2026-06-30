export const ISSUE_DETAIL_QUERY = /* GraphQL */ `
  query IssueDetail($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        number
        title
        bodyHTML
        state
        author { login avatarUrl }
        assignees(first: 20) { nodes { login avatarUrl url } }
        labels(first: 50) { nodes { name color } }
        createdAt
        updatedAt
        url
        comments(first: 100) {
          nodes {
            id
            bodyHTML
            createdAt
            url
            author { login avatarUrl url }
          }
        }
      }
    }
  }
`;
