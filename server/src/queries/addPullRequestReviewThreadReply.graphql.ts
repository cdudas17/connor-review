export const ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION = /* GraphQL */ `
  mutation AddReply($pullRequestReviewThreadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $pullRequestReviewThreadId
      body: $body
    }) {
      comment { id body }
    }
  }
`;
