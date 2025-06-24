'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Database, Code, CheckCircle, XCircle, Loader2, Sparkles, AlertCircle, Copy, Check } from 'lucide-react'

interface Message {
  id: string
  type: 'user' | 'bot' | 'query' | 'result'
  content: string
  timestamp: Date
  query?: string
  result?: any
  answer?: string
}

interface ChatResponse {
  success: boolean
  question: string
  query: string
  error?: string
}

interface ExecuteResponse {
  success: boolean
  question: string
  query: string
  result: any
  answer: string
  error?: string
}

interface HealthResponse {
  status: string
  message: string
  mongodb_connected: boolean
  collections_count?: number
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Welcome to your AI-powered MongoDB assistant! 🚀\n\nI can help you query your database using natural language. Just ask me anything about your data, and I\'ll generate the perfect MongoDB query for you.\n\nExamples:\n• "Show me all users older than 25"\n• "Count orders by status"\n• "Find products with price greater than $100"',
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingQuery, setPendingQuery] = useState<{question: string, query: string} | null>(null)
  const [copiedStates, setCopiedStates] = useState<{[key: string]: boolean}>({})
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    checkConnection()
  }, [])

  const checkConnection = async () => {
    try {
      const response = await fetch(`${API_URL}/health/`)
      const data: HealthResponse = await response.json()
      
      if (data.status === 'healthy' && data.mongodb_connected) {
        setConnectionStatus('connected')
        if (data.collections_count === 0) {
          addMessage({
            type: 'bot',
            content: '⚠️ Warning: Your database appears to be empty. Please add some data to start querying.'
          })
        }
      } else {
        setConnectionStatus('error')
        addMessage({
          type: 'bot',
          content: '❌ Connection Error: Unable to connect to the database. Please check your server configuration.'
        })
      }
    } catch (error) {
      setConnectionStatus('error')
      addMessage({
        type: 'bot',
        content: '❌ Server Error: Unable to connect to the API server. Please make sure the backend is running on port 5000.'
      })
    }
  }

  const addMessage = (message: Omit<Message, 'id' | 'timestamp'>) => {
    const newMessage: Message = {
      ...message,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date()
    }
    setMessages(prev => [...prev, newMessage])
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedStates(prev => ({ ...prev, [id]: true }))
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [id]: false }))
      }, 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading || connectionStatus !== 'connected') return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    addMessage({
      type: 'user',
      content: userMessage
    })

    try {
      const response = await fetch(`${API_URL}/api/chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: userMessage })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data: ChatResponse = await response.json()

      if (data.success) {
        addMessage({
          type: 'query',
          content: `Generated MongoDB Query:\n\`\`\`python\n${data.query}\n\`\`\``,
          query: data.query
        })

        setPendingQuery({
          question: data.question,
          query: data.query
        })
      } else {
        addMessage({
          type: 'bot',
          content: `❌ Error: ${data.error || 'Failed to generate query'}`
        })
      }
    } catch (error) {
      console.error('Error sending message:', error)
      addMessage({
        type: 'bot',
        content: '❌ Sorry, I encountered an error while processing your request. Please check if the server is running and try again.'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleExecuteQuery = async (approve: boolean) => {
    if (!pendingQuery) return

    if (!approve) {
      addMessage({
        type: 'bot',
        content: '❌ Query execution cancelled. Feel free to ask another question!'
      })
      setPendingQuery(null)
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/execute-query/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: pendingQuery.question,
          query: pendingQuery.query
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data: ExecuteResponse = await response.json()

      if (data.success) {
        // Format result for display
        let resultDisplay = ''
        if (Array.isArray(data.result)) {
          if (data.result.length === 0) {
            resultDisplay = 'No results found'
          } else {
            resultDisplay = JSON.stringify(data.result, null, 2)
          }
        } else {
          resultDisplay = JSON.stringify(data.result, null, 2)
        }

        addMessage({
          type: 'result',
          content: `Query Result:\n\`\`\`json\n${resultDisplay}\n\`\`\``,
          result: data.result
        })

        addMessage({
          type: 'bot',
          content: `✅ ${data.answer}`,
          answer: data.answer
        })
      } else {
        addMessage({
          type: 'bot',
          content: `❌ Error executing query: ${data.error || 'Unknown error'}`
        })
      }
    } catch (error) {
      console.error('Error executing query:', error)
      addMessage({
        type: 'bot',
        content: '❌ Sorry, I encountered an error while executing the query. Please try again.'
      })
    } finally {
      setIsLoading(false)
      setPendingQuery(null)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const renderCodeBlock = (code: string, language: string, messageId: string) => {
    const copyId = `${messageId}-${language}`
    return (
      <div className="relative">
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto my-2 border border-gray-700">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400 text-xs uppercase tracking-wide">{language}</span>
            <button
              onClick={() => copyToClipboard(code, copyId)}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded"
              title="Copy to clipboard"
            >
              {copiedStates[copyId] ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <code className="whitespace-pre-wrap">{code}</code>
        </pre>
      </div>
    )
  }

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-400'
      case 'error': return 'text-red-400'
      default: return 'text-yellow-400'
    }
  }

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected'
      case 'error': return 'Disconnected'
      default: return 'Connecting...'
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto bg-gradient-to-br from-slate-50 to-blue-50 shadow-2xl rounded-xl overflow-hidden border border-gray-200">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Database className="w-10 h-10" />
              <Sparkles className="w-4 h-4 absolute -top-1 -right-1 text-yellow-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
                MongoDB AI Assistant
              </h1>
              <p className="text-blue-100 text-sm opacity-90">
                Transform natural language into powerful database queries
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : connectionStatus === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`}></div>
            <span className={`text-sm ${getConnectionStatusColor()}`}>
              {getConnectionStatusText()}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-transparent to-slate-50/50">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-500`}
          >
            <div
              className={`max-w-4xl rounded-2xl px-6 py-4 shadow-lg border ${
                message.type === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-500'
                  : message.type === 'query'
                  ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200 text-amber-900'
                  : message.type === 'result'
                  ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 text-emerald-900'
                  : 'bg-white border-gray-200 text-gray-800'
              }`}
            >
              {message.type === 'query' && (
                <div className="flex items-center space-x-2 mb-3">
                  <Code className="w-5 h-5 text-amber-600" />
                  <span className="text-sm font-semibold text-amber-800">Generated Query</span>
                </div>
              )}

              {message.type === 'result' && (
                <div className="flex items-center space-x-2 mb-3">
                  <Database className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">Query Result</span>
                </div>
              )}

              <div className="whitespace-pre-wrap">
                {message.content.includes('```') ? (
                  <div>
                    {message.content.split('```').map((part, index) => {
                      if (index % 2 === 1) {
                        const [language, ...codeLines] = part.split('\n')
                        const code = codeLines.join('\n')
                        return renderCodeBlock(code, language || 'text', message.id)
                      }
                      return <span key={index} className="leading-relaxed">{part}</span>
                    })}
                  </div>
                ) : (
                  <div className="leading-relaxed">{message.content}</div>
                )}
              </div>

              <div className="text-xs opacity-60 mt-3 flex items-center space-x-2">
                <span>{formatTimestamp(message.timestamp)}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Query Approval Buttons */}
        {pendingQuery && (
          <div className="flex justify-center space-x-4 animate-in fade-in-0 duration-300">
            <button
              onClick={() => handleExecuteQuery(true)}
              disabled={isLoading}
              className="flex items-center space-x-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 disabled:from-emerald-400 disabled:to-green-400 text-white px-6 py-3 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
            >
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Execute Query</span>
            </button>
            <button
              onClick={() => handleExecuteQuery(false)}
              disabled={isLoading}
              className="flex items-center space-x-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 disabled:from-red-400 disabled:to-rose-400 text-white px-6 py-3 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
            >
              <XCircle className="w-5 h-5" />
              <span className="font-medium">Cancel</span>
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center animate-in fade-in-0 duration-300">
            <div className="flex items-center space-x-3 text-gray-600 bg-white px-6 py-3 rounded-xl shadow-lg border border-gray-200">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="font-medium">Processing your request...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-white/80 backdrop-blur-sm p-6">
        <div className="flex space-x-4">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={connectionStatus === 'connected' ? "Ask me anything about your MongoDB data..." : "Connecting to server..."}
              disabled={isLoading || connectionStatus !== 'connected'}
              className="w-full border-2 border-gray-300 rounded-xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-800 placeholder-gray-500 shadow-sm transition-all duration-200 hover:border-gray-400"
            />
            {input && connectionStatus === 'connected' && (
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-sm text-gray-400">
                Press Enter to send
              </div>
            )}
          </div>
          <button
            onClick={handleSendMessage}
            disabled={isLoading || !input.trim() || connectionStatus !== 'connected'}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-8 py-4 rounded-xl transition-all duration-200 flex items-center space-x-3 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
            <span className="font-medium hidden sm:block">Send</span>
          </button>
        </div>
        
        <div className="mt-4 flex items-center justify-center space-x-2 text-xs text-gray-500">
          <AlertCircle className="w-4 h-4" />
          <span>Your queries will be reviewed before execution for safety</span>
        </div>
      </div>
    </div>
  )
}