'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Database, Code, CheckCircle, XCircle, Loader2, Sparkles, AlertCircle, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'

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
      <div className="relative my-3">
        <div className="bg-slate-950 rounded-lg border">
          <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800">
            <Badge variant="secondary" className="text-xs font-mono">
              {language}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(code, copyId)}
              className="h-6 w-6 p-0 text-slate-400 hover:text-slate-100"
            >
              {copiedStates[copyId] ? (
                <Check className="w-3 h-3 text-green-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          </div>
          <pre className="p-4 text-sm text-slate-100 overflow-x-auto">
            <code className="whitespace-pre-wrap">{code}</code>
          </pre>
        </div>
      </div>
    )
  }

  const getConnectionStatusVariant = () => {
    switch (connectionStatus) {
      case 'connected': return 'default'
      case 'error': return 'destructive'
      default: return 'secondary'
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
    <div className="flex flex-col h-screen max-w-6xl mx-auto">
      <Card className="flex-1 flex flex-col overflow-hidden border-0 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        {/* Header */}
        <CardHeader className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white p-6 rounded-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Database className="w-10 h-10" />
                <Sparkles className="w-4 h-4 absolute -top-1 -right-1 text-yellow-300" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">
                  MongoDB AI Assistant
                </h1>
                <p className="text-blue-100 text-sm opacity-90">
                  Transform natural language into powerful database queries
                </p>
              </div>
            </div>
            <Badge variant={getConnectionStatusVariant()} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500' : 
                connectionStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
              }`} />
              {getConnectionStatusText()}
            </Badge>
          </div>
        </CardHeader>

        {/* Messages */}
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-500`}
            >
              <Card
                className={`max-w-4xl ${
                  message.type === 'user'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-500'
                    : message.type === 'query'
                    ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200'
                    : message.type === 'result'
                    ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'
                    : 'bg-background border-border'
                }`}
              >
                <CardContent className="p-6">
                  {message.type === 'query' && (
                    <div className="flex items-center space-x-2 mb-3">
                      <Code className="w-5 h-5 text-amber-600" />
                      <Badge variant="outline" className="text-amber-800 border-amber-300">
                        Generated Query
                      </Badge>
                    </div>
                  )}

                  {message.type === 'result' && (
                    <div className="flex items-center space-x-2 mb-3">
                      <Database className="w-5 h-5 text-emerald-600" />
                      <Badge variant="outline" className="text-emerald-800 border-emerald-300">
                        Query Result
                      </Badge>
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
                </CardContent>
              </Card>
            </div>
          ))}

          {/* Query Approval Buttons */}
          {pendingQuery && (
            <div className="flex justify-center space-x-4 animate-in fade-in-0 duration-300">
              <Button
                onClick={() => handleExecuteQuery(true)}
                disabled={isLoading}
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700"
                size="lg"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                Execute Query
              </Button>
              <Button
                onClick={() => handleExecuteQuery(false)}
                disabled={isLoading}
                variant="destructive"
                size="lg"
              >
                <XCircle className="w-5 h-5 mr-2" />
                Cancel
              </Button>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-center animate-in fade-in-0 duration-300">
              <Card>
                <CardContent className="flex items-center space-x-3 p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="font-medium">Processing your request...</span>
                </CardContent>
              </Card>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        <Separator />

        {/* Input */}
        <div className="p-6 bg-background/95 backdrop-blur-sm">
          <div className="flex space-x-4">
            <div className="flex-1 relative">
              <Input
                type="text"
                value={input}
                onChange={(e:any) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={connectionStatus === 'connected' ? "Ask me anything about your MongoDB data..." : "Connecting to server..."}
                disabled={isLoading || connectionStatus !== 'connected'}
                className="h-12 text-base"
              />
              {input && connectionStatus === 'connected' && (
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-sm text-muted-foreground">
                  Press Enter to send
                </div>
              )}
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim() || connectionStatus !== 'connected'}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-12 px-8"
            >
              <Send className="w-5 h-5 mr-2" />
              <span className="hidden sm:block">Send</span>
            </Button>
          </div>
          
          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your queries will be reviewed before execution for safety
            </AlertDescription>
          </Alert>
        </div>
      </Card>
    </div>
  )
}