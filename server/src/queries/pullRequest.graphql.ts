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
        # MERGEABLE / CONFLICTING / UNKNOWN. GitHub computes this lazily — the
        # first call after a base-branch update may return UNKNOWN until the
        # check finishes. We treat UNKNOWN as "no conflict" client-side.
        mergeable
        reviewDecision
        baseRefName
        headRefName
        headRefOid
        url
        createdAt
        bodyHTML
        viewerLatestReview { id state }
        # Auto-merge ("merge when ready") state for the toggle button. The
        # request is null when auto-merge isn't enabled.
        autoMergeRequest {
          mergeMethod
          enabledAt
          enabledBy { login }
        }
        viewerCanEnableAutoMerge
        # Merge-queue entry — non-null when the PR has been accepted into the
        # repo's merge queue (distinct from plain auto-merge waiting for
        # checks). Lets the UI flip to the amber 'Queued to merge' state.
        mergeQueueEntry {
          position
          state
        }
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
                bodyHTML
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
