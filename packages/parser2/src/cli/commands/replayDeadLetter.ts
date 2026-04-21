/**
 * CLI-команда: parser replay-dead-letter
 *
 * Перемещает события из dead-letter stream обратно в основной поток событий.
 *
 * Схема replay одного события:
 *   1. XRANGE dead-stream: ищем запись с нужным event_id (пагинация).
 *   2. XADD live-stream: добавляем оригинальный payload обратно в основной стрим.
 *   3. XDEL dead-stream: удаляем из dead-letter.
 *   4. HDEL failures-hash: обнуляем счётчик ошибок, иначе при первой же ошибке
 *      событие снова уйдёт в dead-letter (счётчик уже = 3).
 *
 * Поиск по event_id: XRANGE не умеет искать по полям — только по ID записи.
 * Поэтому сканируем с пагинацией: читаем батчами по 100, ищем event_id в JSON.
 * Исключительный курсор '(' + lastId позволяет не читать уже просмотренные записи.
 *
 * Режим --all: воспроизводим все записи из dead-letter за один вызов.
 * Режим --dry-run: показывает что будет сделано без изменений.
 */

import type { RedisStore, StreamMessage } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

/**
 * Ищет запись с нужным event_id в стриме путём последовательного XRANGE.
 * @returns StreamMessage если найдено, null если событие не существует.
 */
async function findByEventId(
  redis: RedisStore,
  stream: string,
  eventId: string,
): Promise<StreamMessage | null> {
  let cursor = '-'
  while (true) {
    const batch = await redis.xrange(stream, cursor, '+', 100)
    if (batch.length === 0) return null
    for (const msg of batch) {
      const dataStr = msg.fields['data']
      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr) as Record<string, unknown>
          if (parsed['event_id'] === eventId) return msg
        } catch { /* пропускаем записи с невалидным JSON */ }
      }
    }
    const last = batch[batch.length - 1]
    // Если получили меньше 100 — конец стрима, событие не найдено
    if (!last || batch.length < 100) return null
    // '(' + lastId — исключительный старт следующей страницы
    cursor = '(' + last.id
  }
}

/**
 * Воспроизводит одно сообщение: XADD → XDEL → HDEL.
 * @returns Новый entry ID в live stream, или null в dry-run режиме.
 */
async function replaySingle(
  redis: RedisStore,
  liveStream: string,
  deadStream: string,
  subId: string,
  msg: StreamMessage,
  dryRun: boolean,
): Promise<string | null> {
  const dataStr = msg.fields['data']
  if (!dataStr) return null

  let eventId = ''
  try {
    const parsed = JSON.parse(dataStr) as Record<string, unknown>
    eventId = typeof parsed['event_id'] === 'string' ? parsed['event_id'] : ''
  } catch { /* игнорируем невалидный JSON */ }

  if (dryRun) {
    console.log(`[dry-run] Would replay event ${eventId || msg.id} → live stream, delete from dead-letter.`)
    return null
  }

  // Шаг 1: добавляем оригинальный payload в основной стрим
  const newId = await redis.xadd(liveStream, { data: dataStr })
  // Шаг 2: удаляем из dead-letter
  await redis.xdel(deadStream, msg.id)
  // Шаг 3: сбрасываем счётчик ошибок — иначе событие снова уйдёт в DL при первой ошибке
  if (eventId) {
    await redis.hdel(RedisKeys.subFailuresHash(subId), eventId)
  }
  return newId
}

/**
 * Основная функция команды replay-dead-letter.
 *
 * @param redis — Redis-клиент.
 * @param chainId — идентификатор цепи.
 * @param subId — идентификатор подписки (определяет dead-letter stream).
 * @param eventId — event_id для воспроизведения (null если all=true).
 * @param all — воспроизвести все события из dead-letter.
 * @param dryRun — только показать, не изменять Redis.
 */
export async function replayDeadLetter(
  redis: RedisStore,
  chainId: string,
  subId: string,
  eventId: string | null,
  all: boolean,
  dryRun: boolean,
): Promise<void> {
  const liveStream = RedisKeys.eventsStream(chainId)
  const deadStream = RedisKeys.deadLetterStream(chainId, subId)

  if (all) {
    let cursor = '-'
    let replayed = 0
    while (true) {
      const batch = await redis.xrange(deadStream, cursor, '+', 100)
      if (batch.length === 0) break
      for (const msg of batch) {
        const newId = await replaySingle(redis, liveStream, deadStream, subId, msg, dryRun)
        if (newId !== null) replayed++
      }
      if (dryRun) {
        // В dry-run не удаляем записи — показываем количество и выходим
        replayed = batch.length
        break
      }
      if (batch.length < 100) break
      // После удаления стрим укорачивается — начинаем сначала
      cursor = '-'
      if (replayed > 0) break // safety: предотвращаем бесконечный цикл
    }
    if (dryRun) {
      console.log(`[dry-run] Would replay ${replayed} events from dead-letter stream for ${subId}.`)
    } else {
      console.log(`Replayed ${replayed} events, removed ${replayed} from dead-letter.`)
    }
    return
  }

  if (!eventId) throw new Error('--event-id is required unless --all is specified')

  const msg = await findByEventId(redis, deadStream, eventId)
  if (!msg) {
    console.error(`Event not found in dead-letter stream for subscription ${subId}.`)
    process.exit(1)
  }

  const newId = await replaySingle(redis, liveStream, deadStream, subId, msg, dryRun)
  if (newId !== null) {
    console.log(`Replayed event ${eventId} → new entry id ${newId}. Removed from dead-letter.`)
  }
}
