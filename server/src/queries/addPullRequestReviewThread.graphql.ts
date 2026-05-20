export const ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION = /* GraphQL */ `
  mutation AddThread(
    $pullRequestId: ID!
    $path: String!
    $body: String!
    $line: Int!
    $side: DiffSide
    $startLine: Int
    $startSide: DiffSide
    $pullRequestReviewId: ID
  ) {
    addPullRequestReviewThread(input: {
      pullRequestId: $pullRequestId
      path: $path
      body: $body
      line: $line
      side: $side
      startLine: $startLine
      startSide: $startSide
      pullRequestReviewId: $pullRequestReviewId
      subjectType: LINE
    }) {
      thread { id }
    }
  }
`;
