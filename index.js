const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

// middlewar
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wx5w5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const userCollection = client.db("alimDb").collection("users");
    const productCollection = client.db("alimDb").collection("product");
    const cartCollection = client.db("alimDb").collection("cart");
    const paymentCollection = client.db("alimDb").collection("payments");

    app.post('/jwt', async(req , res)=>{
      const  user = req.body;
      const token = jwt.sign(user , process.env.ACCESS_TOKEN_SECRET,{
        expiresIn: '1h'
      });
      res.send({token})
    })
    
    const verifyToken = (req , res , next)=>{
      console.log('inside verifyToken', req.headers.authorization);
      if(!req.headers.authorization){
        return res.status(401).send({message: 'unauthorized acces'})
      }
      const token =req.headers.authorization.split( ' ')[1];
      jwt.verify(token , process.env.ACCESS_TOKEN_SECRET , (err , decoded)=>{
        if(err){
          return res.status(401).send({message : 'unauthorized acces'})
        }
        req.decoded=decoded;
        next();
      })
    }

    const verifyAdmin = async (req , res , next)=>{
      const email = req.decoded.email;
      const query = {email: email};
      const user = await userCollection.findOne(query)
      const isAdmin = user?.role === 'admin';
      if(!isAdmin){
        return res.status(403).send({message :'forbidden access' })
      }
      next();
    }

    app.get('/users' , verifyToken, verifyAdmin, async(req , res)=>{
      const result = await userCollection.find().toArray();
      res.send(result)
    })

    app.get('/users/admin/:email', verifyToken, async(req , res)=>{
      const email = req.params.email;
      if(email !==req.decoded.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = {email:email};
      const user = await userCollection.findOne(query);
      let admin = false;
      if(user){
        admin = user?.role === 'admin'
      }
      res.send({ admin });
    })

    app.post('/users' , async(req, res)=>{
      const user = req.body;
      const query = {email: user.email}
      const existingUser = await userCollection.findOne(query);
      if(existingUser){
        return res.send({message: 'user already exists',insertedId: null})
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
  })

  app.patch('/users/admin/:id', verifyToken , verifyAdmin, async (req , res)=>{
    const id = req.params.id;
    const filter = {_id: new ObjectId(id)}
    const updateDoc = {
      $set:{
        role: 'admin'
      }
    }
    const result = await userCollection.updateOne(filter , updateDoc);
    res.send(result);
  })

  app.delete('/users/:id' , verifyToken , verifyAdmin, async(req, res)=>{
    const id =req.params.id;
    const query ={_id: new ObjectId(id)}
    const result = await userCollection.deleteOne(query);
    res.send(result)
  })

    app.get('/product' , async(req, res)=>{
      const result = await productCollection.find().toArray();
      res.send(result)
  })

  app.get('/product/:id' , async (req , res)=>{
    const id = req.params.id;
    const query = {_id: new ObjectId(id)}
    const result = await productCollection.findOne(query)
    res.send(result)
  })

  app.patch('/product/:id', async (req , res)=>{
    const item = req.body;
    const id = req.params.id;
    const filter = { _id: new ObjectId(id)}
    const updateDoc = {
      $set: {
        name: item.name,
        category: item.category,
        price: item.price,
        oldprice:item.oldprice,
        description: item.description,
        image:item.image
      }
    }
    const result = await productCollection.updateOne(filter , updateDoc)
    res.send(result);
  })

  app.post('/product', verifyToken , verifyAdmin, async(req , res)=>{
    const item = req.body;
    const result = await productCollection.insertOne(item);
    res.send(result)
  })

  app.get('/product/:id' , async(req , res)=>{
    const id = req.params.id;
    const query ={_id: new ObjectId(id)}
    const options = {
      projection: {name:1, price:1, oldprice:1, description:1 , image:1}
    };
    const result = await productCollection.findOne(query , options)
    res.send(result)
  })

  app.delete('/product/:id', async(req , res)=>{
    const id = req.params.id;
    const query = { _id: new ObjectId(id)}
    const result = await productCollection.deleteOne(query);
    res.send(result)
  })

  app.post('/carts' , async(req , res)=>{
    const cartItem = req.body;
    const result = await cartCollection.insertOne(cartItem);
    res.send(result)
  })


app.get('/carts', async(req , res)=>{
  const email = req.query.email;
  const query = {email:email};
  const result = await cartCollection.find().toArray();
  res.send(result)
});

app.delete('/carts/:id', async(req , res)=>{
  const id = req.params.id;
  const query = {_id: new ObjectId(id)}
  const result = await cartCollection.deleteOne(query);
  res.send(result);
})

app.post('/create-payment-intent' , async (req , res)=>{
  const { price } = req.body;
  const amount = parseInt(price * 100);


  const paymentIntent = await stripe.paymentIntents.create({
    amount:amount,
    currency:'usd',
    payment_method_types: ['card']
  });

  res.send({
    clientSecret: paymentIntent.client_secret
  })

})

app.post('/payments' , async(req , res)=>{
  const payment = req.body;
  const paymentResult = await paymentCollection.insertOne(payment)

  console.log('payment info' , payment);
  const query = {_id:{
    $in: payment.cartId.map(id => new ObjectId(id))
  }};
  const deleteResult = await cartCollection.deleteMany(query)
  res.send({paymentResult , deleteResult})
})

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/' , (req , res)=>{
    res.send('alims is sitting')
})
app.listen(port, ()=>{
    console.log(`Alims World is sitting on port ${port}`)
})