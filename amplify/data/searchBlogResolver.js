import { util } from "@aws-appsync/utils";
/**
 * Searches for documents by using an input term
 * @param {import('@aws-appsync/utils').Context} ctx the context
 * @returns {*} the request
 */
export function request(ctx) {
  return {
    operation: "GET",
    path: "/todo/_search",
    params: {
      headers: {},
      queryString: { pretty: "true" },
      body: {
        from: 0,
        size: 50,
        query: { match: { content: ctx.args.content } },
      },
    },
  };
}

/**
 * Returns the fetched items
 * @param {import('@aws-appsync/utils').Context} ctx the context
 * @returns {*} the result
 */
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  //add code to include total count

  return ctx.result.hits.hits.map((hit) => hit._source);
}
// export function response(ctx) {
//   const entries = [];
//   for (const entry of ctx.result.hits.hits) {
//     entries.push(entry["_source"]);
//   }
//   return entries;
// }
