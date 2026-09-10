// Type-level view of the `prompts` map in a snapshot. A prompt's arguments are a list of
// `{ name, required? }`, so its typed argument object is `{ [required]: string; [optional]?: string }`:
// `prompts/get` only ever carries string values.
import type { Introspection } from "./index.js";

export type PromptArgumentEntry = { name: string; required?: boolean };
export type PromptEntry = { arguments: readonly PromptArgumentEntry[] };

/** The prompt map of a snapshot, or `{}` when the server declared no `prompts` capability. */
type PromptsOf<I extends Introspection> = I extends {
  prompts: infer P extends Record<string, PromptEntry>;
}
  ? P
  : {};

export type PromptNames<I extends Introspection> = keyof PromptsOf<I> & string;

/** One prompt's recorded argument list, `[]` for a name the snapshot does not know. */
export type PromptArgumentsOf<I extends Introspection, N extends string> =
  PromptsOf<I> extends infer P
    ? N extends keyof P
      ? P[N] extends { arguments: infer A extends readonly PromptArgumentEntry[] }
        ? A
        : readonly []
      : readonly []
    : readonly [];

type RequiredNames<A extends readonly PromptArgumentEntry[]> = A[number] extends infer E
  ? E extends { name: infer N extends string; required: true }
    ? N
    : never
  : never;

type OptionalNames<A extends readonly PromptArgumentEntry[]> = Exclude<
  A[number]["name"],
  RequiredNames<A>
>;

/** The typed `arguments` object for one prompt: required arguments as `string`, the rest as
 * `string | undefined`, closed to the declared names. */
export type PromptArgsFrom<A extends readonly PromptArgumentEntry[]> = {
  [N in RequiredNames<A>]: string;
} & {
  [N in OptionalNames<A>]?: string;
};

export type PromptArgs<I extends Introspection, N extends PromptNames<I>> = PromptArgsFrom<
  PromptArgumentsOf<I, N>
>;

/** True when no argument is `required: true`, so the `arguments` object can be omitted. */
export type HasNoRequiredPromptArgs<A extends readonly PromptArgumentEntry[]> = [
  RequiredNames<A>,
] extends [never]
  ? true
  : false;
