export const RedisKeys = {
  eventsStream: (chainId: string) => `ce:parser2:${chainId}:events`,
  deadLetterStream: (chainId: string, subId: string) => `ce:parser2:${chainId}:dead:${subId}`,
  reparseStream: (chainId: string, jobId: string) => `ce:parser2:${chainId}:reparse:${jobId}`,
  abiZset: (contract: string) => `parser2:abi:${contract}`,
  syncHash: (chainId: string) => `parser2:sync:${chainId}`,
  subsHash: () => `parser2:subs`,
  subFailuresHash: (subId: string) => `parser2:sub:${subId}:failures`,
  subLock: (subId: string) => `parser2:sub:${subId}:lock`,
  reparseJobHash: (jobId: string) => `parser2:reparse:${jobId}`,
} as const
