#!/usr/bin/env python3
"""
MongoDB AI Chat Django API Server
Provides REST API endpoints for the React frontend to interact with MongoDB via AI-generated queries
"""

import os
import sys
import json
import logging
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv
from bson import ObjectId
from typing_extensions import TypedDict, Annotated
from langchain.chat_models import init_chat_model
from langgraph import graph as langgraph

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings')

from django.conf import settings
if not settings.configured:
    settings.configure(
        DEBUG=True,
        SECRET_KEY='your-secret-key-here-make-it-long-and-random-123456789',
        ROOT_URLCONF=__name__,
        ALLOWED_HOSTS=['*'],
        INSTALLED_APPS=[
            'django.contrib.contenttypes',
            'django.contrib.auth',
            'corsheaders',
        ],
        MIDDLEWARE=[
            'corsheaders.middleware.CorsMiddleware',
            'django.middleware.common.CommonMiddleware',
            'django.middleware.security.SecurityMiddleware',
        ],
        APPEND_SLASH=False,
        CORS_ALLOW_ALL_ORIGINS=True,
        CORS_ALLOW_CREDENTIALS=True,
        CORS_ALLOWED_HEADERS=[
            'accept',
            'accept-encoding',
            'authorization',
            'content-type',
            'dnt',
            'origin',
            'user-agent',
            'x-csrftoken',
            'x-requested-with',
        ],
        USE_TZ=True,
        LOGGING={
            'version': 1,
            'disable_existing_loggers': False,
            'handlers': {
                'console': {
                    'class': 'logging.StreamHandler',
                },
            },
            'root': {
                'handlers': ['console'],
                'level': 'INFO',
            },
        },
    )

import django
django.setup()

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.urls import path
from django.core.wsgi import get_wsgi_application

# Global variables for LLM and graph
llm = None
graph = None

# LangGraph State and Output Types
class State(TypedDict):
    question: str
    query: str
    result: str
    answer: str

class QueryOutput(TypedDict):
    """Generated MongoDB query."""
    query: Annotated[str, ..., "Valid MongoDB query in Python syntax."]

# MongoDB connection functions
def get_mongo_client():
    """Get MongoDB client connection."""
    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        raise ValueError("MONGO_URI not set in environment variables.")
    return MongoClient(mongo_uri)

def get_collection_info():
    """Get information about available collections and their structure."""
    try:
        client = get_mongo_client()
        db = client["app-dev"]
        
        collection_names = db.list_collection_names()
        collection_info = {}
        
        for collection_name in collection_names:
            collection = db[collection_name]
            # Get sample documents to understand structure
            sample_docs = list(collection.find().limit(2))
            if sample_docs:
                # Get all unique keys from sample documents
                all_keys = set()
                for doc in sample_docs:
                    all_keys.update(doc.keys())
                collection_info[collection_name] = {
                    "fields": list(all_keys),
                    "sample_document": sample_docs[0] if sample_docs else None,
                    "document_count": collection.count_documents({})
                }
            else:
                collection_info[collection_name] = {
                    "fields": [],
                    "sample_document": None,
                    "document_count": 0
                }
        
        return collection_info
    except Exception as e:
        logger.error(f"Error getting collection info: {e}")
        return {}

def convert_objectid(obj):
    """Convert ObjectId to string for JSON serialization."""
    if isinstance(obj, list):
        return [convert_objectid(item) for item in obj]
    elif isinstance(obj, dict):
        return {
            key: str(value) if isinstance(value, ObjectId) else convert_objectid(value) 
            for key, value in obj.items()
        }
    elif isinstance(obj, ObjectId):
        return str(obj)
    else:
        return obj

# LangGraph Node Functions
def write_query(state: State):
    """Generate MongoDB query to fetch information."""
    try:
        collection_info = get_collection_info()
        
        prompt = f"""
        Write a MongoDB query in Python syntax to answer the question: {state["question"]}
        
        Available collections and their structure:
        {json.dumps(collection_info, indent=2, default=str)}
        
        Based on the collection structure shown above, generate a Python MongoDB query.
        The code should use the 'db' variable which is already connected to the database.
        
        Example patterns:
        - Find documents: list(db.collection_name.find({{"field": "value"}}))
        - Count documents: db.collection_name.count_documents({{"field": "value"}})
        - Aggregate: list(db.collection_name.aggregate([{{"$match": {{"field": "value"}}}}]))
        - Find with projection: list(db.collection_name.find({{"field": "value"}}, {{"field1": 1, "field2": 1}}))
        - Sort and limit: list(db.collection_name.find({{"field": "value"}}).sort("field", 1).limit(10))
        
        Important: 
        - Return only the Python code that can be executed with eval()
        - Use only READ operations (find, count_documents, aggregate)
        - Do not use any write operations (insert, update, delete, drop)
        """
        
        structured_llm = llm.with_structured_output(QueryOutput)
        result = structured_llm.invoke(prompt)
        return {"query": result["query"]}
    except Exception as e:
        logger.error(f"Error generating query: {e}")
        return {"query": f"# Error generating query: {str(e)}"}

def execute_query(state: State):
    """Execute MongoDB query."""
    try:
        client = get_mongo_client()
        db = client["app-dev"]
        
        # Basic security check
        dangerous_operations = ['drop', 'delete', 'remove', 'update', 'replace', 'insert', 
                               'create', 'rename', 'aggregate_write']
        query_lower = state["query"].lower()
        for op in dangerous_operations:
            if op in query_lower:
                raise Exception(f"Dangerous operation '{op}' not allowed")
        
        # Execute the query
        result = eval(state["query"])
        
        # Convert cursor to list if needed
        if hasattr(result, 'to_list'):
            result = list(result)
        elif hasattr(result, '__iter__') and not isinstance(result, (str, dict)):
            result = list(result)
        
        # Convert ObjectId to string for JSON serialization
        result = convert_objectid(result)
        
        return {"result": json.dumps(result, default=str, ensure_ascii=False)}
    
    except Exception as e:
        error_msg = f"Error executing query: {str(e)}"
        logger.error(error_msg)
        return {"result": error_msg}

def generate_answer(state: State):
    """Answer question using retrieved information as context."""
    try:
        prompt = (
            "Given the following user question, corresponding MongoDB query, "
            "and MongoDB result, provide a clear and helpful answer to the user's question.\n\n"
            f'Question: {state["question"]}\n'
            f'MongoDB Query: {state["query"]}\n'
            f'MongoDB Result: {state["result"]}\n\n'
            "Please provide a natural language summary of the results. If the result is empty, "
            "explain that no matching documents were found. If there's an error, explain what went wrong."
        )
        response = llm.invoke(prompt)
        return {"answer": response.content}
    except Exception as e:
        error_msg = f"Error generating answer: {str(e)}"
        logger.error(error_msg)
        return {"answer": error_msg}

# Django Views
@csrf_exempt
def health_check(request):
    """Health check endpoint."""
    try:
        # Test MongoDB connection
        client = get_mongo_client()
        db = client["app-dev"]
        collections = db.list_collection_names()
        
        return JsonResponse({
            "status": "healthy", 
            "message": "MongoDB AI Chat API is running",
            "mongodb_connected": True,
            "collections_count": len(collections),
            "collections": collections
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JsonResponse({
            "status": "error",
            "message": f"Health check failed: {str(e)}",
            "mongodb_connected": False
        }, status=500)

@csrf_exempt
@require_http_methods(["GET"])
def get_collections(request):
    """Get collection information endpoint."""
    try:
        collection_info = get_collection_info()
        return JsonResponse({
            "success": True, 
            "collections": collection_info
        })
    except Exception as e:
        logger.error(f"Error getting collections: {e}")
        return JsonResponse({
            "success": False, 
            "error": str(e)
        }, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def chat(request):
    """Generate MongoDB query from natural language question."""
    try:
        data = json.loads(request.body)
        question = data.get('question', '').strip()
        
        if not question:
            return JsonResponse({
                "success": False,
                "error": "Question is required"
            }, status=400)
        
        logger.info(f"Generating query for question: {question}")
        
        # Use LangGraph to generate query
        session_id = "api_session_" + str(os.urandom(4).hex())
        config = {"configurable": {"thread_id": session_id}}
        
        initial_state = {"question": question}
        result = write_query(initial_state)
        
        logger.info(f"Generated query: {result['query']}")
        
        return JsonResponse({
            "success": True,
            "question": question,
            "query": result["query"]
        })
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return JsonResponse({
            "success": False,
            "error": str(e)
        }, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def execute_query_endpoint(request):
    """Execute a specific MongoDB query and generate natural language answer."""
    try:
        data = json.loads(request.body)
        question = data.get('question', '').strip()
        query = data.get('query', '').strip()
        
        if not question or not query:
            return JsonResponse({
                "success": False,
                "error": "Question and query are required"
            }, status=400)
        
        logger.info(f"Executing query: {query}")
        
        # Execute query
        client = get_mongo_client()
        db = client["app-dev"]
        
        # Basic security check
        dangerous_operations = ['drop', 'delete', 'remove', 'update', 'replace', 'insert',
                               'create', 'rename', 'aggregate_write']
        query_lower = query.lower()
        for op in dangerous_operations:
            if op in query_lower:
                raise Exception(f"Dangerous operation '{op}' not allowed")
        
        # Execute the query
        result = eval(query)
        
        if hasattr(result, 'to_list'):
            result = list(result)
        elif hasattr(result, '__iter__') and not isinstance(result, (str, dict)):
            result = list(result)
        
        # Convert ObjectId to string for JSON serialization
        result = convert_objectid(result)
        
        logger.info(f"Query result count: {len(result) if isinstance(result, list) else 'N/A'}")
        
        # Generate answer using the complete state
        state = {
            "question": question,
            "query": query,
            "result": json.dumps(result, default=str, ensure_ascii=False)
        }
        
        answer_result = generate_answer(state)
        
        return JsonResponse({
            "success": True,
            "question": question,
            "query": query,
            "result": result,
            "answer": answer_result["answer"]
        })
    except Exception as e:
        logger.error(f"Execute query error: {str(e)}")
        return JsonResponse({
            "success": False,
            "error": str(e)
        }, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def chat_complete(request):
    """Complete chat flow - generate query, execute, and generate answer in one call."""
    try:
        data = json.loads(request.body)
        question = data.get('question', '').strip()
        
        if not question:
            return JsonResponse({
                "success": False,
                "error": "Question is required"
            }, status=400)
        
        logger.info(f"Complete chat flow for question: {question}")
        
        # Use complete LangGraph flow
        session_id = "api_session_" + str(os.urandom(4).hex())
        config = {"configurable": {"thread_id": session_id}}
        
        initial_state = {"question": question}
        
        # Run through the complete graph
        final_result = graph.invoke(initial_state, config)
        
        # Parse result to get actual data for JSON response
        try:
            result_data = json.loads(final_result["result"])
        except:
            result_data = final_result["result"]
        
        logger.info(f"Complete chat flow completed successfully")
        
        return JsonResponse({
            "success": True,
            "question": question,
            "query": final_result["query"],
            "result": result_data,
            "answer": final_result["answer"]
        })
    except Exception as e:
        logger.error(f"Chat complete error: {str(e)}")
        return JsonResponse({
            "success": False,
            "error": str(e)
        }, status=500)

# URL Configuration
urlpatterns = [
    path('health/', health_check, name='health'),
    path('api/collections/', get_collections, name='collections'),
    path('api/chat/', chat, name='chat'),
    path('api/execute-query/', execute_query_endpoint, name='execute_query'),
    path('api/chat-complete/', chat_complete, name='chat_complete'),
]

# WSGI Application
application = get_wsgi_application()

def initialize_services():
    """Initialize all required services."""
    global llm, graph
    
    print("🚀 MongoDB AI Chat API Starting...")
    
    # Check required environment variables
    required_vars = ['MONGO_URI', 'MISTRAL_API_KEY']
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print(f"❌ Error: Missing environment variables: {', '.join(missing_vars)}")
        print("Please create a .env file with:")
        print("MONGO_URI=mongodb://your-connection-string")
        print("MISTRAL_API_KEY=your-mistral-api-key")
        return False
    
    # Initialize LangChain LLM
    try:
        llm = init_chat_model("mistral-large-latest", model_provider="mistralai")
        print("✅ Mistral LLM initialized successfully")
    except Exception as e:
        print(f"❌ Mistral LLM initialization failed: {e}")
        return False
    
    # Test MongoDB connection
    try:
        client = get_mongo_client()
        db = client["app-dev"]
        collections = db.list_collection_names()
        print(f"✅ Connected to MongoDB: app-dev")
        print(f"✅ Collections found: {collections}")
        if not collections:
            print("⚠️  Warning: No collections found in database")
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        return False
    
    # Initialize LangGraph
    try:
        builder = langgraph.StateGraph(State)
        builder.add_node("write_query", write_query)
        builder.add_node("execute_query", execute_query)
        builder.add_node("generate_answer", generate_answer)

        builder.add_edge("write_query", "execute_query")
        builder.add_edge("execute_query", "generate_answer")

        builder.set_entry_point("write_query")
        graph = builder.compile()
        print("✅ LangGraph initialized successfully")
    except Exception as e:
        print(f"❌ LangGraph initialization failed: {e}")
        return False
    
    return True

if __name__ == "__main__":
    if not initialize_services():
        sys.exit(1)
    
    print("🎉 All systems ready!")
    print("📡 Starting Django server on http://localhost:5000")
    print("\nAvailable endpoints:")
    print("- GET  /health/ - Health check")
    print("- GET  /api/collections/ - Get collection info")
    print("- POST /api/chat/ - Generate query only")
    print("- POST /api/execute-query/ - Execute specific query")
    print("- POST /api/chat-complete/ - Complete chat flow")
    print("\nFrontend should be running on http://localhost:3000")
    print("Make sure NEXT_PUBLIC_API_URL=http://localhost:5000 in your .env.local file")
    
    # Run Django development server
    from django.core.management import execute_from_command_line
    sys.argv = ['app.py', 'runserver', '0.0.0.0:5000']
    execute_from_command_line(sys.argv)