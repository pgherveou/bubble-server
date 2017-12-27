import http from 'http'
import io from 'socket.io-client'
import socketIO from 'socket.io'
import superagent from 'superagent'
import test from 'ava'
import { Proxy } from '../dist/lib'

async function makeServer() {
  return new Promise(resolve => {
    const proxy = new Proxy()
    const server = http.createServer(proxy.makeRequestListener())
    proxy.setSocketIO(socketIO(server))
    server.listen(0, () =>
      resolve({
        server,
        proxy,
        url: `http://localhost:${server.address().port}`
      })
    )
  })
}

test('No client connected', async t => {
  const { url, server } = await makeServer()
  try {
    await superagent.get(url)
  } catch (err) {
    t.true(err.response.status === 503)
    t.true(
      err.response.text.split('\n').shift() === 'Error: No client connected'
    )
  } finally {
    server.close()
  }
})

test('Too many client connected', async t => {
  const { url, server } = await makeServer()
  const sockets = Array(2)
    .fill('')
    .map(() =>
      io(url, {
        multiplex: false,
        transports: ['websocket']
      })
    )

  await Promise.all(
    sockets.map(s => new Promise(resolve => s.once('connect', () => resolve())))
  )

  try {
    await superagent.get(url)
  } catch (err) {
    t.true(err.response.status === 503)
    t.true(
      err.response.text.split('\n').shift() ===
        'Error: Too many client connected'
    )
  } finally {
    server.close()
  }
})

test('Socket disconnect', async t => {
  const { url, server } = await makeServer()
  const socket = io(url, { transports: ['websocket'] })

  socket.once('request', async (request, ack) => {
    socket.disconnect()
  })

  try {
    await new Promise(resolve => socket.once('connect', () => resolve()))
    const response = await superagent.get(url)
  } catch (err) {
    t.true(err.response.status === 503)
    t.true(
      err.response.text.split('\n').shift() === 'Error: Client disconnected'
    )
  } finally {
    server.close()
  }
})

test('Get response from socket', async t => {
  const { url, server } = await makeServer()
  const socket = io(url, { transports: ['websocket'] })

  const response = {
    headers: { 'x-test': 'test', 'content-type': 'text' },
    statusCode: 200,
    rawData: Buffer.from('hello')
  }

  socket.once('request', async (request, ack) => {
    ack(response)
  })

  try {
    await new Promise(resolve => socket.once('connect', () => resolve()))
    const actualResponse = await superagent.get(url)
    t.true(actualResponse.status == response.statusCode)
    t.true(actualResponse.headers['x-test'] == response.headers['x-test'])
    t.true(actualResponse.text == response.rawData.toString())
  } finally {
    server.close()
  }
})