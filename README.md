# Actions on Google: Trivia Game using Node.js

The Trivia Game let's users play an interactive game with various personas. Includes classic game show sounds and humor, for a touch of nostalgia.

You can also try out a hosted version of this game at [https://triviatemplate.com/](https://triviatemplate.com/).

## Setup Instructions

### Steps
1. Use the [Actions on Google Console](https://console.actions.google.com) to add a new project with a name of your choosing.
1. Under *Build a custom app*, click *BUILD* in the Dialogflow box and then click *Create Actions on Dialogflow*.
1. Click *Save* to save the project.
1. Click on the gear icon to see the project settings.
1. Select *Export and Import*.
1. Select *Restore from zip*. Follow the directions to restore from the `TriviaGame.zip` file in this repo.
1. Deploy the fulfillment webhook provided in the `functions` folder using [Google Cloud Functions for Firebase](https://firebase.google.com/docs/functions/) and the static resources needed by the project using [Firebase Hosting](https://firebase.google.com/docs/hosting/):
    1. Follow the instructions to [install the Firebase CLI](https://firebase.google.com/docs/hosting/quickstart#install-the-firebase-cli).
    1. Run `firebase init`, and select to configure `Hosting` and `Functions`. Select the project you've previously created in the Actions on Google Console as default project. In the configuration wizard, accept all the default choices.
    1. Edit the database data with questions (questions.json) and prompts (prompts.json). Generate a private key using Firebase Settings/Service Accounts, and edit `functions/database.js` with the path to the JSON cert file. Now populate the database: `node database.js`
    1. Run `firebase deploy` and take note of the endpoint where the fulfillment webhook has been published. It should look like `Function URL (triviaGame): https://us-central1-YOUR_PROJECT.cloudfunctions.net/triviaGame`. The command will also deploy the static assets at `https://us-central1-YOUR_PROJECT.cloudfunctions.net/`.
1. Go back to the Dialogflow console and select *Fulfillment* from the left navigation menu. Enable *Webhook*, set the value of *URL* to the `Function URL` from the previous step, then click *Save*.
1. Select *Integrations* from the left navigation menu and open the *Settings* menu for Actions on Google.
1. Click *Test*.
1. Click *View* to open the Actions on Google simulator.
1. Type `Talk to my test app` in the simulator, or say `OK Google, talk to my test app` to any Actions on Google enabled device signed into your developer account.

For more detailed information on deployment, see the [documentation](https://developers.google.com/actions/dialogflow/deploy-fulfillment).

## References and How to report bugs
* Actions on Google documentation: [https://developers.google.com/actions/](https://developers.google.com/actions/).
* If you find any issues, please open a bug here on GitHub.
* Questions are answered on [StackOverflow](https://stackoverflow.com/questions/tagged/actions-on-google).

## How to make contributions?
Please read and follow the steps in the [CONTRIBUTING.md](CONTRIBUTING.md).

## License
See [LICENSE](LICENSE).

## Terms
Your use of this sample is subject to, and by using or downloading the sample files you agree to comply with, the [Google APIs Terms of Service](https://developers.google.com/terms/).

## Google+
Actions on Google Developers Community on Google+ [https://g.co/actionsdev](https://g.co/actionsdev).
