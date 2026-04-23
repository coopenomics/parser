/**
 * Единый реестр Redis-ключей.
 *
 * Все ключи определены в одном месте, чтобы избежать опечаток и упростить
 * поиск по кодовой базе. Полная документация формата — docs/redis-key-taxonomy.md.
 *
 * Префиксы:
 *   ce:parser2:<chainId>:  — Stream-ключи, относящиеся к конкретной цепи.
 *   parser:               — Hash/ZSET/String ключи с глобальным скоупом.
 */
export const RedisKeys = {
  /**
   * Главный поток событий парсера (unified event stream).
   * Тип Redis: Stream. Тримируется XtrimSupervisor'ом.
   * Пример: ce:parser2:eos-mainnet:events
   */
  eventsStream: (chainId: string) => `ce:parser2:${chainId}:events`,

  /**
   * Dead-letter поток для конкретной подписки.
   * Содержит сообщения, которые не смог обработать consumer после N попыток.
   * Тип Redis: Stream.
   * Пример: ce:parser2:eos-mainnet:dead:verifier
   */
  deadLetterStream: (chainId: string, subId: string) => `ce:parser2:${chainId}:dead:${subId}`,

  /**
   * Поток для задания on-demand reparse (зарезервировано для будущего).
   * Тип Redis: Stream.
   */
  reparseStream: (chainId: string, jobId: string) => `ce:parser2:${chainId}:reparse:${jobId}`,

  /**
   * История версий ABI конкретного контракта.
   * Тип Redis: Sorted Set. Score = block_num, member = base64(rawAbiBytes).
   * При поиске ABI для блока N используется ZREVRANGEBYSCORE … N -inf LIMIT 0 1.
   * Пример: parser2:abi:eosio.token
   */
  abiZset: (contract: string) => `parser2:abi:${contract}`,

  /**
   * Контрольная точка синхронизации парсера (crash-recovery).
   * Тип Redis: Hash. Поля: block_num, block_id, last_updated.
   * При рестарте парсер читает отсюда позицию и продолжает с неё.
   */
  syncHash: (chainId: string) => `parser2:sync:${chainId}`,

  /**
   * Реестр всех зарегистрированных подписок.
   * Тип Redis: Hash. Ключ поля = subId, значение = JSON-метаданные подписки.
   */
  subsHash: () => `parser2:subs`,

  /**
   * Счётчики ошибок per-event для конкретной подписки.
   * Тип Redis: Hash. Ключ поля = event_id, значение = число провалов.
   * TTL: 24 часа (обновляется при каждом новом провале).
   * Используется FailureTracker для решения о переводе в dead-letter.
   */
  subFailuresHash: (subId: string) => `parser2:sub:${subId}:failures`,

  /**
   * Блокировка single-active-consumer для подписки.
   * Тип Redis: String (instanceId держателя блокировки). TTL: 10 с (автопродление).
   * Только один экземпляр consumer-а может быть active; остальные — standby.
   */
  subLock: (subId: string) => `parser2:sub:${subId}:lock`,

  /**
   * Метаданные задания reparse (зарезервировано для будущего).
   * Тип Redis: Hash.
   */
  reparseJobHash: (jobId: string) => `parser2:reparse:${jobId}`,
} as const
