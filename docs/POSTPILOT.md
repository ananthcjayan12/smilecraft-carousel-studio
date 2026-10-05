# Publish and schedule Instagram carousels

The carousel review screen includes **Publish with PostPilot** after artwork is ready. Approve artwork, choose **Publish or schedule**, check the connected Instagram account, select **Publish now** or **Schedule for later**, and press **Send to PostPilot**. All original slides are uploaded in position order with the displayed caption. Instagram carousels require 2–10 slides.

The date picker uses the browser's displayed time zone and sends UTC to PostPilot. Its scheduler dispatches at minute intervals; provider processing can add delays. **Refresh status** reads the remote outcome. Only an Instagram success with a published post records publication in this studio. Failed publication exposes **Retry failed publication**; PostPilot review outcomes must be resolved in PostPilot.

## Connect from Settings

1. In [PostPilot](https://postpilot.ananth-c-jayan.workers.dev/), connect the clinic's Instagram account under Accounts and enable scheduling in Settings.
2. Create an API key in PostPilot **Settings → External API access**.
3. In this studio, select the clinic and open **Settings → PostPilot publishing**.
4. Enter the PostPilot URL and API key, then click **Connect PostPilot**. The studio checks Instagram readiness before saving the connection and shows the connected account.
5. Use **Check connection** whenever needed. Leave the API key blank when saving to keep the existing key; enter a new key to replace it. Changing the URL requires a new key.

Connections are stored separately for each clinic and studio account. API keys are saved in the private server database, never returned by the settings API or prefilled in the browser. **Disconnect** removes the stored connection; it does not cancel posts already scheduled in PostPilot. No GitHub secrets, environment variables or clinic ID entry are needed for connection setup.

The application update adds database migrations `0015_postpilot.sql` and `0016_postpilot_connections.sql`. Local startup applies them automatically; the normal hosted deployment applies D1 migrations.

## Delivery and recovery

The server creates a draft, persists the PostPilot ID, then starts publication or schedules that draft. Repeated sends reuse the recorded post. A database lock blocks concurrent uploads. Network failure while starting publication can be checked using **Refresh status** without creating another post.

If draft creation times out before its ID is recorded, the delivery stays in `review`. Check PostPilot manually. The studio intentionally blocks new sends rather than guessing whether a remote draft was created. Reconcile the stored `v4_postpilot` row with the verified PostPilot draft before retrying. It never automatically deletes uploaded media or remote posts.

A carousel changed after sending cannot be sent again using the existing delivery record. Review or update its existing post in PostPilot. Deleting studio content does not cancel a scheduled PostPilot post; cancel/manage it in PostPilot.

The status refresh is explicit, so a scheduled post is recorded as published in this studio the next time its remote status is refreshed. This implementation does not run a background synchronization task.

No live publication is performed by development or tests. Verification uses mocked PostPilot uploads and post responses.
