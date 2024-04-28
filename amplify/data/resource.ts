import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/*== STEP 1 ===============================================================
The section below creates a Todo database table with a "content" field. Try
adding a new "isDone" field as a boolean. The authorization rule below
specifies that any user authenticated via an API key can "create", "read",
"update", and "delete" any "Todo" records.
=========================================================================*/
const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
      done: a.boolean(),
      priority: a.enum(["low", "medium", "high"]),
    })
    .authorization((allow) => [allow.publicApiKey()]),
  Todo1: a
    .model({
      content: a.string(),
      done: a.boolean(),
      priority: a.enum(["low", "medium", "high"]),
    })
    .authorization((allow) => [allow.publicApiKey()]),
  // searchTodos2: a.query().returns(a.ref("Todo").array()),
  searchTodos5: a
    .query()
    .returns(a.ref("Todo").array())
    .authorization((allow) => [allow.publicApiKey()])
    .handler(
      a.handler.custom({
        entry: "./searchBlogResolver.js",
        dataSource: "osDataSource",
      })
    ),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});


