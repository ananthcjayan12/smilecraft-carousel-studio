# Adjust clinic credits

Open the admin dashboard and use **Adjust clinic credits**. Choose the clinic account, select **Add credits**, **Remove credits** or **Set available balance**, enter a whole number and a reason, then click **Apply credit adjustment**. The dashboard reloads account balances after saving. **Refresh balances** fetches current balances before a change.

Credits are shared by clinics belonging to the same account. The available balance excludes credits reserved by running work. Adjustments cannot reduce the available balance below zero. If generation changes the balance while the form is open, refresh balances and submit again.

Only the configured studio administrator can call the adjustment endpoint. Each change records its reason, admin identity, signed credit change and before/after balance in `admin_credit_adjustments`. Repeated submissions with the same request ID apply once. Existing ledger entries and plan allocations are preserved; a credit adjustment does not activate or change the clinic's subscription.

The application update adds migration `0017_admin_credit_adjustments.sql`, applied through the normal hosted D1 deployment.
